import type Database from 'better-sqlite3';
import type * as D from '../../shared/relatorios-ipc';
import { record, identifier, integer, active } from './catalog-validation';
import { ComercialError, commercialDate } from './comercial';
import { localDay, saldoReembolsoApurado } from './financeiro';
import { situacaoParcela } from '../domain/correcoes';
import * as sql from './relatorios-sql';
type Params = Record<string, string | number | null>;
const S = (v: string) => `coalesce(mnr_rel_soma(${v}),0)`;
const fail = (): never => {
  throw new ComercialError('VALIDATION', 'Filtros de relatório inválidos.');
};
function safe(n: bigint): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new ComercialError('INTEGRITY', 'Agregado fora do limite seguro.');
  return Number(n);
}
function rounded(n: bigint, d: bigint) {
  return safe((n < 0n ? -1n : 1n) * ((2n * (n < 0n ? -n : n) + d) / (2n * d)));
}
function checked<T>(v: T): T {
  if (typeof v === 'number' && !Number.isSafeInteger(v))
    throw new ComercialError('INTEGRITY', 'Valor fora do limite seguro.');
  if (v && typeof v === 'object') Object.values(v).forEach(checked);
  return v;
}
const periodKeys = ['dataInicio', 'dataFim'];
const commercialKeys = [...periodKeys, 'clienteId', 'produtoId'];
const financialKeys = [...periodKeys, 'clienteId', 'formaPagamentoId'];
const pageKeys = ['limite', 'deslocamento'];
function choice<T extends string>(raw: unknown, values: readonly T[], fallback: T): T {
  if (raw === undefined) return fallback;
  return typeof raw === 'string' && values.includes(raw as T) ? (raw as T) : fail();
}
function period(f: Record<string, unknown>) {
  const inicio = commercialDate(f['dataInicio']),
    fim = commercialDate(f['dataFim']);
  // UTC is used only for counting ISO calendar days, never to assign business dates.
  const days = (Date.parse(fim + 'T00:00:00Z') - Date.parse(inicio + 'T00:00:00Z')) / 86400000;
  if (days < 0 || days >= 366) fail();
  return { inicio, fim };
}
export function createReportService(db: Database.Database, clock: () => Date = () => new Date()) {
  db.aggregate('mnr_rel_soma', {
    start: 0n,
    safeIntegers: true,
    step: (sum: bigint, value: bigint) => sum + BigInt(value ?? 0),
    result: (sum: bigint) => {
      safe(sum);
      return sum;
    },
  });
  db.function(
    'mnr_rel_saldo',
    { deterministic: true },
    (original: number, abatido: number, recebido: number, vence: string, hoje: string) =>
      situacaoParcela(original, abatido, recebido, vence, hoje).saldoCentavos,
  );
  db.function(
    'mnr_rel_status',
    { deterministic: true },
    (original: number, abatido: number, recebido: number, vence: string, hoje: string) =>
      situacaoParcela(original, abatido, recebido, vence, hoje).status,
  );
  db.function('mnr_rel_reembolso', { deterministic: true }, saldoReembolsoApurado);
  const one = <T>(q: string, p: Params) => checked(db.prepare(q).get(p) as T);
  const all = <T>(q: string, p: Params) => checked(db.prepare(q).all(p) as T[]);
  let readAt: Date | undefined;
  const currentTime = () => readAt ?? clock();
  const ref = (): D.ReferenciaRelatorio => {
    const now = currentTime();
    return { dataReferencia: localDay(now), consultadoEm: now.toISOString() };
  };
  const read = <T>(action: () => T) =>
    db.transaction(() => {
      const previous = readAt;
      readAt = clock();
      try {
        return action();
      } finally {
        readAt = previous;
      }
    })();
  function id(
    f: Record<string, unknown>,
    field: string,
    table: 'clientes' | 'produtos' | 'formas_pagamento' | 'documentos',
  ) {
    if (f[field] === undefined) return null;
    const n = identifier(f[field]);
    // Table is an internal literal union; input never supplies an SQL identifier.
    if (
      !db
        .prepare(
          `SELECT id FROM ${table} WHERE id=?${table === 'documentos' ? " AND tipo='VENDA' AND estado IN ('CONFIRMADO','ESTORNADO')" : ''}`,
        )
        .get(n)
    )
      throw new ComercialError('NOT_FOUND', 'Referência não encontrada.');
    return n;
  }
  function filters(f: Record<string, unknown>): Params {
    return {
      cliente: id(f, 'clienteId', 'clientes'),
      produto: id(f, 'produtoId', 'produtos'),
      forma: id(f, 'formaPagamentoId', 'formas_pagamento'),
    };
  }
  function paging(f: Record<string, unknown>): Params {
    return {
      limite: f['limite'] === undefined ? 25 : integer(f['limite'], 'limite', 1, 200),
      offset:
        f['deslocamento'] === undefined
          ? 0
          : integer(f['deslocamento'], 'deslocamento', 0, 1_000_000),
    };
  }
  function page<T, U>(
    prefix: string,
    select: string,
    total: string,
    order: string,
    p: Params,
  ): D.PaginaRelatorio<T, U> {
    const rows = all<T>(`${prefix} ${select} ORDER BY ${order} LIMIT @limite+1 OFFSET @offset`, p);
    return {
      ...ref(),
      itens: rows.slice(0, Number(p['limite'])),
      temMais: rows.length > Number(p['limite']),
      totais: one<U>(`${prefix} ${total}`, p),
    };
  }
  const original = (category: string, column: string) =>
    S(`CASE WHEN categoria='${category}' THEN ${column} ELSE 0 END`);
  type CommercialBase = Omit<
    D.FluxoComercial,
    'perdasImpropriosLiquidasCentavos' | 'resultadoBrutoEstimadoCentavos' | 'margemBrutaPontosBase'
  >;
  const commercialColumns = `
      count(DISTINCT CASE WHEN categoria='VENDA' THEN vendaId END) AS vendasConfirmadas,
      ${original('VENDA', 'bruto')} AS brutoVendasCentavos,${original('VENDA', 'valor')} AS vendasAposDescontosCentavos,
      ${original('DEVOLUCAO', 'valor')} AS devolucoesRegistradasCentavos,${original('CANCELAMENTO', 'valor')} AS cancelamentosCentavos,${original('ESTORNO_DEVOLUCAO', 'valor')} AS estornosDevolucaoCentavos,
      ${S("CASE WHEN categoria='DEVOLUCAO' THEN valor WHEN categoria='ESTORNO_DEVOLUCAO' THEN -valor ELSE 0 END")} AS devolucoesEfetivasCentavos,
      ${S('sinal*valor')} AS faturamentoLiquidoCentavos,${S('sinal*custo')} AS cmvHistoricoLiquidoCentavos,
      ${original('VENDA', 'quantidade')} AS unidadesVendidas,${original('DEVOLUCAO', 'quantidade')} AS unidadesDevolvidas,
      ${S("CASE WHEN categoria='DEVOLUCAO' THEN quantidade WHEN categoria='ESTORNO_DEVOLUCAO' THEN -quantidade ELSE 0 END")} AS unidadesDevolvidasEfetivas,
      ${original('CANCELAMENTO', 'quantidade')} AS unidadesCanceladas,${original('ESTORNO_DEVOLUCAO', 'quantidade')} AS unidadesEstornoDevolucao,${S('sinal*quantidade')} AS unidadesLiquidas`;
  const lossFrom = `FROM movimentacoes_estoque m
      LEFT JOIN movimentacoes_estoque o ON o.id=m.movimentacao_origem_id
      JOIN vinculos_estoque_comercial l ON l.movimentacao_id=m.id JOIN itens_documento i ON i.id=l.item_documento_id
      JOIN documentos d ON d.id=i.documento_id JOIN documentos a ON a.id=d.documento_origem_id
      JOIN documentos v ON v.id=CASE WHEN a.tipo='VENDA' THEN a.id ELSE a.documento_origem_id END
      WHERE v.tipo='VENDA' AND (m.natureza='PERDA_DEVOLUCAO' OR o.natureza='PERDA_DEVOLUCAO')
      AND m.data_efetiva BETWEEN @inicio AND @fim AND (@cliente IS NULL OR v.cliente_id=@cliente) AND (@produto IS NULL OR m.produto_id=@produto)`;
  function commercialResult(r: CommercialBase, loss: number): D.FluxoComercial {
    const result = safe(
      BigInt(r.faturamentoLiquidoCentavos) - BigInt(r.cmvHistoricoLiquidoCentavos) - BigInt(loss),
    );
    return {
      ...r,
      perdasImpropriosLiquidasCentavos: loss,
      resultadoBrutoEstimadoCentavos: result,
      margemBrutaPontosBase:
        r.faturamentoLiquidoCentavos > 0
          ? rounded(BigInt(result) * 10000n, BigInt(r.faturamentoLiquidoCentavos))
          : null,
    };
  }
  function commercial(p: Params): D.FluxoComercial {
    return commercialResult(
      one<CommercialBase>(
        `${sql.eventos} SELECT ${commercialColumns} FROM eventos WHERE ${sql.fluxoEvento}`,
        p,
      ),
      one<{ valor: number }>(`SELECT ${S('-m.valor_delta_centavos')} AS valor ${lossFrom}`, p)
        .valor,
    );
  }
  const financeTotal = `SELECT ${S("CASE WHEN natureza='RECEBIMENTO' THEN valorCentavos ELSE 0 END")} AS recebimentosBrutosCentavos,
    ${S("CASE WHEN natureza='ESTORNO_RECEBIMENTO' THEN valorCentavos ELSE 0 END")} AS estornosRecebimentosCentavos,
    ${S("CASE WHEN natureza='RECEBIMENTO' THEN valorCentavos WHEN natureza='ESTORNO_RECEBIMENTO' THEN -valorCentavos ELSE 0 END")} AS recebidoLiquidoCentavos,
    ${S("CASE WHEN natureza='PAGAMENTO_REEMBOLSO' THEN valorCentavos ELSE 0 END")} AS pagamentosReembolsoCentavos,
    ${S("CASE WHEN natureza='ESTORNO_REEMBOLSO' THEN valorCentavos ELSE 0 END")} AS estornosReembolsoCentavos,
    ${S("CASE WHEN natureza='PAGAMENTO_REEMBOLSO' THEN valorCentavos WHEN natureza='ESTORNO_REEMBOLSO' THEN -valorCentavos ELSE 0 END")} AS reembolsoPagoLiquidoCentavos FROM filtrados`;
  const accountTotal = `SELECT ${S('saldoCentavos')} AS exigivelCentavos,${S("CASE WHEN status='VENCIDO' THEN saldoCentavos ELSE 0 END")} AS vencidoCentavos,
    ${S('CASE WHEN vencimento>=@hoje THEN saldoCentavos ELSE 0 END')} AS aVencerCentavos,
    count(CASE WHEN saldoCentavos>0 THEN 1 END) AS parcelasAbertas,count(CASE WHEN status='VENCIDO' THEN 1 END) AS parcelasVencidas,count(CASE WHEN saldoCentavos=0 THEN 1 END) AS parcelasQuitadas FROM filtrados`;
  const refundTotal = `SELECT count(CASE WHEN ativa THEN 1 END) AS obrigacoesAtivas,count(CASE WHEN ativa AND pendenteCentavos>0 THEN 1 END) AS obrigacoesPendentes,
    count(CASE WHEN ativa AND pendenteCentavos=0 THEN 1 END) AS obrigacoesQuitadas,${S('CASE WHEN ativa THEN originalCentavos ELSE 0 END')} AS valorOriginalAtivoCentavos,
    ${S('CASE WHEN ativa THEN pagoLiquidoCentavos ELSE 0 END')} AS pagoLiquidoAtivoCentavos,${S('pendenteCentavos')} AS pendenteCentavos FROM filtrados`;
  const stockTotal = `SELECT count(*) AS produtos,${S('quantidade')} AS unidades,${S('valorCentavos')} AS valorCentavos,
    count(CASE WHEN quantidade=0 THEN 1 END) AS semEstoque,count(CASE WHEN quantidade<estoqueMinimo THEN 1 END) AS abaixoMinimo FROM filtrados`;
  const saleTotal = `SELECT count(*) AS vendas,${S('originalCentavos')} AS originalCentavos,${S('comercialLiquidoAtualCentavos')} AS comercialLiquidoAtualCentavos,${S('custoHistoricoLiquidoAtualCentavos')} AS custoHistoricoLiquidoAtualCentavos FROM coorte`;
  function position(f: Record<string, unknown>, refund: boolean): Params {
    const p: Params = {
      ...filters(f),
      venda: id(f, 'vendaId', 'documentos'),
      hoje: localDay(currentTime()),
      de: null,
      ate: null,
      situacao: refund
        ? choice(f['situacao'], ['TODAS', 'PENDENTES', 'QUITADAS', 'ANULADAS'], 'TODAS')
        : choice(f['situacao'], ['TODAS', 'ABERTAS', 'VENCIDAS', 'A_VENCER', 'QUITADAS'], 'TODAS'),
    };
    if (!refund) {
      p['de'] = f['vencimentoDe'] === undefined ? null : commercialDate(f['vencimentoDe']);
      p['ate'] = f['vencimentoAte'] === undefined ? null : commercialDate(f['vencimentoAte']);
      if (p['de'] && p['ate'] && p['de'] > p['ate']) fail();
    }
    if (
      p['venda'] &&
      p['cliente'] &&
      !db
        .prepare('SELECT 1 FROM documentos WHERE id=? AND cliente_id=?')
        .get(p['venda'], p['cliente'])
    )
      fail();
    return p;
  }
  function series<T>(input: unknown, financial: boolean): D.SerieRelatorio<T> {
    const f = record(input, [...(financial ? financialKeys : commercialKeys), 'agrupamento']);
    const range = period(f),
      p = { ...filters(f), ...range, natureza: null };
    const grouping = choice(f['agrupamento'], ['DIARIO', 'MENSAL'], 'DIARIO');
    const itens: ({ competencia: string } & T)[] = [];
    const group = grouping === 'DIARIO' ? 'dataEfetiva' : 'substr(dataEfetiva,1,7)';
    const values = new Map<string, T>();
    if (financial) {
      for (const row of all<D.FluxoFinanceiro & { competencia: string }>(
        `${sql.financeiros} ${financeTotal.replace('SELECT ', `SELECT ${group} AS competencia,`)} GROUP BY ${group}`,
        p,
      ))
        values.set(row.competencia, row as T);
    } else {
      const lossGroup = grouping === 'DIARIO' ? 'm.data_efetiva' : 'substr(m.data_efetiva,1,7)';
      const losses = new Map(
        all<{ competencia: string; valor: number }>(
          `SELECT ${lossGroup} AS competencia,${S('-m.valor_delta_centavos')} AS valor ${lossFrom} GROUP BY ${lossGroup}`,
          p,
        ).map((r) => [r.competencia, r.valor]),
      );
      for (const row of all<CommercialBase & { competencia: string }>(
        `${sql.eventos} SELECT ${group} AS competencia,${commercialColumns} FROM eventos WHERE ${sql.fluxoEvento} GROUP BY ${group}`,
        p,
      ))
        values.set(row.competencia, commercialResult(row, losses.get(row.competencia) ?? 0) as T);
    }
    const zero = (
      financial
        ? one<D.FluxoFinanceiro>(`${sql.financeiros} ${financeTotal} WHERE 0`, p)
        : commercialResult(
            one<CommercialBase>(
              `${sql.eventos} SELECT ${commercialColumns} FROM eventos WHERE 0`,
              p,
            ),
            0,
          )
    ) as T;
    const date = new Date(range.inicio + 'T00:00:00Z');
    if (grouping === 'MENSAL') date.setUTCDate(1);
    const endTime = Date.parse(range.fim + 'T23:59:59Z');
    while (date.getTime() <= endTime) {
      const competencia = date.toISOString().slice(0, grouping === 'DIARIO' ? 10 : 7);
      itens.push({ competencia, ...(values.get(competencia) ?? zero) });
      if (grouping === 'DIARIO') date.setUTCDate(date.getUTCDate() + 1);
      else date.setUTCMonth(date.getUTCMonth() + 1);
    }
    return {
      ...ref(),
      periodo: { dataInicio: range.inicio, dataFim: range.fim },
      agrupamento: grouping,
      itens,
    };
  }
  return {
    listarMovimentacaoProdutos: (input: unknown) =>
      read(() => {
        const f = record(input, [...periodKeys, ...pageKeys, 'produtoId']),
          p = { ...period(f), ...filters(f), ...paging(f) };
        const prefix = `WITH ranking AS (SELECT p.id AS produtoId,p.nome AS nomeAtual,p.sku AS skuAtual,count(*) AS movimentos,${S('abs(m.quantidade_delta)')} AS unidadesMovimentadas FROM movimentacoes_estoque m JOIN produtos p ON p.id=m.produto_id WHERE m.data_efetiva BETWEEN @inicio AND @fim AND (@produto IS NULL OR m.produto_id=@produto) GROUP BY p.id)`;
        return page<
          {
            produtoId: number;
            nomeAtual: string;
            skuAtual: string;
            movimentos: number;
            unidadesMovimentadas: number;
          },
          { produtos: number; movimentos: number; unidadesMovimentadas: number }
        >(
          prefix,
          'SELECT produtoId,nomeAtual,skuAtual,movimentos,unidadesMovimentadas FROM ranking',
          `SELECT count(*) AS produtos,${S('movimentos')} AS movimentos,${S('unidadesMovimentadas')} AS unidadesMovimentadas FROM ranking`,
          'movimentos DESC,produtoId',
          p,
        );
      }),
    listarTotaisPorForma: (input: unknown) =>
      read(() => {
        const f = record(input, [...financialKeys, ...pageKeys]),
          p = { ...period(f), ...filters(f), ...paging(f), natureza: null };
        const prefix = `${sql.financeiros}, grupos AS (${financeTotal.replace('SELECT ', 'SELECT formaPagamentoId,formaHistorica,')} GROUP BY formaPagamentoId,formaHistorica)`;
        return page<
          D.FluxoFinanceiro & { formaPagamentoId: number; formaHistorica: string },
          D.FluxoFinanceiro
        >(
          prefix,
          'SELECT formaPagamentoId,formaHistorica,recebimentosBrutosCentavos,estornosRecebimentosCentavos,recebidoLiquidoCentavos,pagamentosReembolsoCentavos,estornosReembolsoCentavos,reembolsoPagoLiquidoCentavos FROM grupos',
          financeTotal,
          'formaPagamentoId,formaHistorica',
          p,
        );
      }),
    obterResumoGerencial: (input: unknown): D.ResumoGerencial =>
      read(() => {
        const f = record(input, [...periodKeys, 'clienteId']),
          p = { ...period(f), ...filters(f), natureza: null };
        const ticket = one<{ valor: number; count: number }>(
          `${sql.coorte} SELECT ${S('comercialLiquidoAtualCentavos')} AS valor,count(CASE WHEN comercialLiquidoAtualCentavos>0 THEN 1 END) AS count FROM coorte`,
          p,
        );
        const pos = position(f, false);
        return {
          ...ref(),
          periodo: { dataInicio: String(p.inicio), dataFim: String(p.fim) },
          fluxoComercial: commercial(p),
          fluxoFinanceiro: one<D.FluxoFinanceiro>(`${sql.financeiros} ${financeTotal}`, p),
          posicaoAtual: {
            contas: one<D.PosicaoContas>(`${sql.contas} ${accountTotal}`, pos),
            reembolsos: one<D.PosicaoReembolsos>(`${sql.reembolsos} ${refundTotal}`, pos),
          },
          coorteVendas: {
            comercialLiquidoAtualCentavos: ticket.valor,
            vendasComValorPositivo: ticket.count,
            ticketMedioCentavos: ticket.count
              ? rounded(BigInt(ticket.valor), BigInt(ticket.count))
              : null,
          },
        };
      }),
    obterSeriesVendas: (i: unknown) => read(() => series<D.FluxoComercial>(i, false)),
    obterSeriesRecebimentos: (i: unknown) => read(() => series<D.FluxoFinanceiro>(i, true)),
    listarVendas: (input: unknown) =>
      read(() => {
        const f = record(input, [...commercialKeys, ...pageKeys, 'ordem']),
          p = { ...period(f), ...filters(f), ...paging(f) };
        const order = choice(f['ordem'], ['DATA_DESC', 'VALOR_DESC'], 'DATA_DESC');
        return page<D.VendaRelatorio, D.TotaisVendas>(
          sql.coorte,
          'SELECT vendaId,numero,dataComercial,clienteId,clienteNomeHistorico,estado,originalCentavos,comercialLiquidoAtualCentavos,custoHistoricoLiquidoAtualCentavos FROM coorte',
          saleTotal,
          order === 'DATA_DESC'
            ? 'dataComercial DESC,vendaId DESC'
            : 'comercialLiquidoAtualCentavos DESC,vendaId DESC',
          p,
        );
      }),
    listarProdutos: (input: unknown) =>
      read(() => {
        const f = record(input, [...commercialKeys, ...pageKeys, 'ordem']),
          p = { ...period(f), ...filters(f), ...paging(f) };
        const order = choice(f['ordem'], ['UNIDADES_DESC', 'VALOR_DESC'], 'UNIDADES_DESC');
        const prefix = `${sql.eventos}, nomes AS (SELECT produtoId,skuHistorico,nomeHistorico,sinal,quantidade,valor,row_number() OVER(PARTITION BY produtoId ORDER BY CASE WHEN categoria='VENDA' THEN 0 ELSE 1 END,dataEfetiva DESC,itemId DESC) AS rn FROM eventos WHERE ${sql.fluxoEvento}), ranking AS (SELECT produtoId,max(CASE WHEN rn=1 THEN skuHistorico END) AS skuHistorico,max(CASE WHEN rn=1 THEN nomeHistorico END) AS nomeHistorico,${S('sinal*quantidade')} AS unidadesLiquidas,${S('sinal*valor')} AS comercialLiquidoCentavos FROM nomes GROUP BY produtoId)`;
        return page<
          D.ProdutoRanking,
          { produtos: number; unidadesLiquidas: number; comercialLiquidoCentavos: number }
        >(
          prefix,
          'SELECT produtoId,skuHistorico,nomeHistorico,unidadesLiquidas,comercialLiquidoCentavos FROM ranking',
          `SELECT count(*) AS produtos,${S('unidadesLiquidas')} AS unidadesLiquidas,${S('comercialLiquidoCentavos')} AS comercialLiquidoCentavos FROM ranking`,
          order === 'UNIDADES_DESC'
            ? 'unidadesLiquidas DESC,produtoId'
            : 'comercialLiquidoCentavos DESC,produtoId',
          p,
        );
      }),
    listarClientes: (input: unknown) =>
      read(() => {
        const f = record(input, [...periodKeys, 'clienteId', ...pageKeys]),
          p = { ...period(f), ...filters(f), ...paging(f) };
        const prefix = `${sql.coorte}, nomes AS (SELECT clienteId,clienteNomeHistorico,comercialLiquidoAtualCentavos,row_number() OVER(PARTITION BY clienteId ORDER BY dataComercial DESC,vendaId DESC) AS rn FROM coorte WHERE clienteId IS NOT NULL), ranking AS (SELECT clienteId,max(CASE WHEN rn=1 THEN clienteNomeHistorico END) AS nomeHistorico,${S('comercialLiquidoAtualCentavos')} AS comercialLiquidoAtualCentavos,count(*) AS vendas FROM nomes GROUP BY clienteId)`;
        return page<D.ClienteRanking, { clientes: number; comercialLiquidoAtualCentavos: number }>(
          prefix,
          'SELECT clienteId,nomeHistorico,comercialLiquidoAtualCentavos,vendas FROM ranking',
          `SELECT count(*) AS clientes,${S('comercialLiquidoAtualCentavos')} AS comercialLiquidoAtualCentavos FROM ranking`,
          'comercialLiquidoAtualCentavos DESC,clienteId',
          p,
        );
      }),
    listarMovimentos: (input: unknown) =>
      read(() => {
        const f = record(input, [...financialKeys, ...pageKeys, 'ordem', 'natureza']),
          p = {
            ...period(f),
            ...filters(f),
            ...paging(f),
            natureza:
              f['natureza'] === undefined
                ? null
                : choice(
                    f['natureza'],
                    [
                      'RECEBIMENTO',
                      'ESTORNO_RECEBIMENTO',
                      'PAGAMENTO_REEMBOLSO',
                      'ESTORNO_REEMBOLSO',
                    ],
                    'RECEBIMENTO',
                  ),
          };
        const order = choice(f['ordem'], ['DATA_DESC', 'VALOR_DESC'], 'DATA_DESC');
        return page<D.MovimentoRelatorio, D.FluxoFinanceiro>(
          sql.financeiros,
          'SELECT id,vendaId,vendaNumero,clienteId,clienteNomeHistorico,natureza,formaPagamentoId,formaHistorica,valorCentavos,dataEfetiva,registradoEm,estornaMovimentoId FROM filtrados',
          financeTotal,
          order === 'DATA_DESC' ? 'dataEfetiva DESC,id DESC' : 'valorCentavos DESC,id DESC',
          p,
        );
      }),
    listarContasReceber: (input: unknown) =>
      read(() => {
        const f = record(input, [
          ...pageKeys,
          'clienteId',
          'vendaId',
          'vencimentoDe',
          'vencimentoAte',
          'situacao',
        ]);
        return page<D.ContaRelatorio, D.PosicaoContas>(
          sql.contas,
          'SELECT id,vendaId,vendaNumero,clienteId,clienteNomeHistorico,tipo,vencimento,originalCentavos,recebimentosLiquidosCentavos,abatimentosLiquidosCentavos,saldoCentavos,status FROM filtrados',
          accountTotal,
          'vencimento,vendaId,id',
          { ...position(f, false), ...paging(f) },
        );
      }),
    listarReembolsos: (input: unknown) =>
      read(() => {
        const f = record(input, [...pageKeys, 'clienteId', 'vendaId', 'situacao']);
        const result = page<
          Omit<D.ReembolsoRelatorio, 'ativa'> & { ativa: number },
          D.PosicaoReembolsos
        >(
          sql.reembolsos,
          'SELECT id,vendaId,correcaoId,clienteId,clienteNomeHistorico,ativa,originalCentavos,pagoLiquidoCentavos,pendenteCentavos FROM filtrados',
          refundTotal,
          'id DESC',
          { ...position(f, true), ...paging(f) },
        );
        return { ...result, itens: result.itens.map((r) => ({ ...r, ativa: !!r.ativa })) };
      }),
    listarSaldos: (input: unknown) =>
      read(() => {
        const f = record(input, [...pageKeys, 'produtoId', 'ativo', 'situacao', 'ordem']);
        const order = choice(f['ordem'], ['ID', 'QUANTIDADE_DESC', 'VALOR_DESC'], 'ID');
        const result = page<
          Omit<D.SaldoProdutoRelatorio, 'ativo'> & { ativo: number },
          D.PosicaoEstoque
        >(
          sql.saldosProdutos,
          'SELECT produtoId,nomeAtual,skuAtual,ativo,estoqueMinimo,quantidade,valorCentavos FROM filtrados',
          stockTotal,
          order === 'ID'
            ? 'produtoId'
            : order === 'QUANTIDADE_DESC'
              ? 'quantidade DESC,produtoId'
              : 'valorCentavos DESC,produtoId',
          {
            ...filters(f),
            ...paging(f),
            ativo: f['ativo'] === undefined ? null : Number(active(f['ativo'])),
            situacao: choice(f['situacao'], ['TODOS', 'SEM_ESTOQUE', 'BAIXO'], 'TODOS'),
          },
        );
        return { ...result, itens: result.itens.map((r) => ({ ...r, ativo: !!r.ativo })) };
      }),
    obterResumoEstoque: (input: unknown): D.ResumoEstoqueRelatorio =>
      read(() => {
        const f = record(input, [...periodKeys, 'produtoId']),
          p = { ...period(f), ...filters(f), ativo: null, situacao: 'TODOS' };
        return {
          ...ref(),
          periodo: { dataInicio: p.inicio, dataFim: p.fim },
          posicaoAtual: one<D.PosicaoEstoque>(`${sql.saldosProdutos} ${stockTotal}`, p),
          movimentosPeriodo: all(
            `SELECT natureza,count(*) AS movimentos,${S('quantidade_delta')} AS quantidadeDelta,${S('valor_delta_centavos')} AS valorDeltaCentavos FROM movimentacoes_estoque WHERE data_efetiva BETWEEN @inicio AND @fim AND (@produto IS NULL OR produto_id=@produto) GROUP BY natureza ORDER BY natureza`,
            p,
          ),
        };
      }),
  };
}
