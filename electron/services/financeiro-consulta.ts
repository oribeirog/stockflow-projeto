import type Database from 'better-sqlite3';
import type {
  ConsultaParcelas,
  ConsultaReembolsos,
  ParcelaConsulta,
  ReembolsoConsulta,
  MovimentoConsultaFinanceiro,
  DetalheMovimentoFinanceiro,
  VendaFinanceira,
  VinculoVenda,
  DetalheParcela,
  DetalheReembolso,
} from '../../shared/financeiro-ipc';
import type {
  DocumentoCorretivo,
  DetalheCorrecao,
  ContextoVendaConsulta,
} from '../../shared/correcoes-ipc';
import { record, identifier, integer } from './catalog-validation';
import { ComercialError, commercialDate } from './comercial';
import {
  parcelasFinanceiras,
  resumoFinanceiro,
  saldoReembolso,
  total,
  localDay,
} from './financeiro';

const invalid = (): never => {
  throw new ComercialError('VALIDATION', 'Consulta inválida.');
};
const missing = (): never => {
  throw new ComercialError('NOT_FOUND', 'Registro financeiro não encontrado.');
};
const saleColumns = `d.id AS vendaId,d.numero AS vendaNumero,d.estado AS vendaEstado,d.cliente_id AS clienteId,d.contraparte_nome AS clienteNomeHistorico,c.ativo AS clienteAtivo`;
const saleJoin = `JOIN documentos d ON d.id=p.venda_id LEFT JOIN clientes c ON c.id=d.cliente_id`;
const allowedSale = `d.tipo='VENDA' AND d.estado IN ('CONFIRMADO','ESTORNADO')`;
type RawLink = Omit<VinculoVenda, 'clienteAtivo'> & { clienteAtivo: number | null };
const link = (v: RawLink): VinculoVenda => ({
  vendaId: v.vendaId,
  vendaNumero: v.vendaNumero,
  vendaEstado: v.vendaEstado,
  clienteId: v.clienteId,
  clienteNomeHistorico: v.clienteNomeHistorico,
  clienteAtivo: v.clienteAtivo === null ? null : !!v.clienteAtivo,
});
const pageKeys = ['limite', 'deslocamento'];
const filterKeys = [...pageKeys, 'clienteId', 'vendaId'];
const page = (v: Record<string, unknown>) => ({
  limite: v['limite'] === undefined ? 25 : integer(v['limite'], 'limite', 1, 200),
  deslocamento:
    v['deslocamento'] === undefined
      ? 0
      : integer(v['deslocamento'], 'deslocamento', 0, 1_000_000_000),
});
const optionalId = (v: unknown) => (v === undefined ? null : identifier(v));

// Read projections only. Every public operation runs in a single read transaction.
// SQL balance predicates select the page; returned amounts/statuses use official 3D helpers.
export function createFinancialQueryService(
  db: Database.Database,
  clock: () => Date = () => new Date(),
) {
  const all = <T>(sql: string, ...args: (number | string | null)[]) =>
    db.prepare(sql).all(...args) as T[];
  const get = <T>(sql: string, ...args: (number | string | null)[]) =>
    db.prepare(sql).get(...args) as T | undefined;
  const today = () => localDay(clock());
  function sale(id: number) {
    const d = get<RawLink & { dataComercial: string; modalidadeVenda: 'A_VISTA' | 'A_PRAZO' }>(
      `SELECT ${saleColumns},d.data_comercial AS dataComercial,d.modalidade_venda AS modalidadeVenda FROM documentos d LEFT JOIN clientes c ON c.id=d.cliente_id WHERE d.id=? AND ${allowedSale}`,
      id,
    );
    return d ?? missing();
  }
  function slice<T>(rows: T[], limit: number, dataReferencia: string) {
    return { itens: rows.slice(0, limit), temMais: rows.length > limit, dataReferencia };
  }
  function parcela(
    id: number,
    day: string,
    cache = new Map<number, ReturnType<typeof parcelasFinanceiras>>(),
  ): ParcelaConsulta {
    const p =
      get<{ vendaId: number }>('SELECT venda_id AS vendaId FROM parcelas_receber WHERE id=?', id) ??
      missing();
    const d = sale(p.vendaId);
    if (!cache.has(p.vendaId)) cache.set(p.vendaId, parcelasFinanceiras(db, p.vendaId, day));
    const official = cache.get(p.vendaId)!.find((p) => p.id === id) ?? missing();
    return { ...link(d), ...official, modalidadeVenda: d.modalidadeVenda };
  }
  function refund(id: number): ReembolsoConsulta {
    const r =
      get<{
        id: number;
        vendaId: number;
        correcaoId: number;
        correcaoNumero: string;
        dataEfetiva: string;
        estado: string;
        valorOriginalCentavos: number;
      }>(
        `SELECT r.id,x.documento_origem_id AS vendaId,x.id AS correcaoId,x.numero AS correcaoNumero,x.data_comercial AS dataEfetiva,x.estado,r.valor_centavos AS valorOriginalCentavos FROM reembolsos_cliente r JOIN documentos x ON x.id=r.documento_correcao_id WHERE r.id=? AND x.tipo IN ('DEV_VENDA','ESTORNO')`,
        id,
      ) ?? missing();
    const d = sale(r.vendaId);
    const amount = (kind: string) =>
      total(
        db,
        `SELECT a.valor_centavos AS valor FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id WHERE o.reembolso_id=? AND a.natureza=?`,
        id,
        kind,
      );
    const pagosCentavos = amount('PAGAMENTO'),
      estornosCentavos = amount('ESTORNO');
    return {
      ...link(d),
      id,
      correcaoId: r.correcaoId,
      correcaoNumero: r.correcaoNumero,
      dataEfetiva: r.dataEfetiva,
      ativa: r.estado === 'CONFIRMADO',
      valorOriginalCentavos: r.valorOriginalCentavos,
      pagosCentavos,
      estornosCentavos,
      pagoLiquidoCentavos: pagosCentavos - estornosCentavos,
      saldoExigivelCentavos: r.estado === 'CONFIRMADO' ? saldoReembolso(db, id) : 0,
    };
  }
  const movementSql = `SELECT m.id,m.documento_id AS vendaId,m.natureza,m.sentido,m.valor_centavos AS valorCentavos,m.forma_pagamento_id AS formaPagamentoId,m.forma_pagamento_historica AS formaHistorica,m.data_efetiva AS dataEfetiva,m.registrado_em AS registradoEm,m.operacao_id AS operacaoId,(SELECT a.motivo FROM eventos_auditoria a WHERE a.operacao_id=m.operacao_id ORDER BY a.id LIMIT 1) AS motivo,m.estorna_movimento_id AS estornaMovimentoId,(SELECT e.id FROM movimentos_financeiros e WHERE e.estorna_movimento_id=m.id) AS estornadoPorId FROM movimentos_financeiros m`;
  function movement(id: number, vendaId: number) {
    sale(vendaId);
    return (
      get<MovimentoConsultaFinanceiro>(
        `${movementSql} WHERE m.id=? AND m.documento_id=?`,
        id,
        vendaId,
      ) ?? missing()
    );
  }
  const correctionSql = `SELECT x.id,x.numero,x.documento_origem_id AS origemId,x.tipo,x.estado,x.data_comercial AS dataEfetiva,x.total_centavos AS totalCentavos,x.observacoes AS motivo,${saleColumns},(SELECT e.id FROM documentos e WHERE e.documento_origem_id=x.id AND e.tipo='ESTORNO' AND e.estado='CONFIRMADO') AS estornadoPorId FROM documentos x JOIN documentos origem ON origem.id=x.documento_origem_id JOIN documentos d ON d.id=CASE WHEN origem.tipo='VENDA' THEN origem.id ELSE origem.documento_origem_id END LEFT JOIN clientes c ON c.id=d.cliente_id WHERE ${allowedSale} AND x.estado IN ('CONFIRMADO','ESTORNADO') AND (x.tipo='DEV_VENDA' AND origem.tipo='VENDA' OR x.tipo='ESTORNO' AND origem.tipo IN ('VENDA','DEV_VENDA'))`;
  function correction(id: number, vendaId: number): DocumentoCorretivo {
    sale(vendaId);
    const r =
      get<RawLink & Omit<DocumentoCorretivo, keyof VinculoVenda | 'categoria'> & { tipo: string }>(
        `${correctionSql} AND x.id=? AND d.id=?`,
        id,
        vendaId,
      ) ?? missing();
    return {
      ...link(r),
      id: r.id,
      numero: r.numero,
      origemId: r.origemId,
      categoria:
        r.tipo === 'DEV_VENDA'
          ? 'DEVOLUCAO_VENDA'
          : r.origemId === vendaId
            ? 'CANCELAMENTO_VENDA'
            : 'ESTORNO_DEVOLUCAO',
      estado: r.estado,
      dataEfetiva: r.dataEfetiva,
      totalCentavos: r.totalCentavos,
      motivo: r.motivo,
      estornadoPorId: r.estornadoPorId,
    };
  }
  const read = <T>(fn: () => T) => db.transaction(fn)();
  return {
    listarParcelas(input: unknown) {
      return read(() => {
        const v = record(input, [...filterKeys, 'situacao', 'vencimentoDe', 'vencimentoAte']);
        const { limite, deslocamento } = page(v),
          day = today();
        const cliente = optionalId(v['clienteId']),
          venda = optionalId(v['vendaId']);
        const de = v['vencimentoDe'] === undefined ? null : commercialDate(v['vencimentoDe']);
        const ate = v['vencimentoAte'] === undefined ? null : commercialDate(v['vencimentoAte']);
        if (de && ate && de > ate) invalid();
        const state = (v['situacao'] ?? 'EM_ABERTO') as ConsultaParcelas['situacao'];
        const predicates = {
          EM_ABERTO: 'saldo>0',
          PENDENTE: 'saldo>0 AND recebido=0 AND vencimento>=@hoje',
          PARCIALMENTE_PAGO: 'saldo>0 AND recebido>0',
          QUITADO: 'saldo=0',
          VENCIDO: 'saldo>0 AND vencimento<@hoje',
          TODAS: '1=1',
        };
        if (!state || !Object.hasOwn(predicates, state)) invalid();
        const rows = db
          .prepare(
            `WITH base AS (SELECT p.*,coalesce((SELECT sum(CASE natureza WHEN 'APLICACAO' THEN valor_centavos ELSE -valor_centavos END) FROM alocacoes_recebimento WHERE parcela_id=p.id),0) AS recebido,coalesce((SELECT sum(CASE natureza WHEN 'ABATIMENTO' THEN valor_centavos ELSE -valor_centavos END) FROM abatimentos_parcela WHERE parcela_id=p.id),0) AS abatido FROM parcelas_receber p ${saleJoin} WHERE ${allowedSale} AND (@cliente IS NULL OR d.cliente_id=@cliente) AND (@venda IS NULL OR d.id=@venda) AND (@de IS NULL OR p.vencimento>=@de) AND (@ate IS NULL OR p.vencimento<=@ate)), balances AS (SELECT *,max(valor_original_centavos-recebido-abatido,0) AS saldo FROM base) SELECT id FROM balances WHERE ${predicates[state!]} ORDER BY vencimento,venda_id,numero,id LIMIT @limite OFFSET @offset`,
          )
          .all({
            cliente,
            venda,
            de,
            ate,
            hoje: day,
            limite: limite + 1,
            offset: deslocamento,
          }) as { id: number }[];
        const cache = new Map<number, ReturnType<typeof parcelasFinanceiras>>();
        return slice(
          rows.map((p) => parcela(p.id, day, cache)),
          limite,
          day,
        );
      });
    },
    obterParcela(input: unknown): DetalheParcela {
      return read(() => {
        const id = identifier(input),
          day = today();
        return {
          ...parcela(id, day),
          dataReferencia: day,
          abatimentos: all(
            `SELECT id,documento_correcao_id AS correcaoId,natureza,valor_centavos AS valorCentavos,estorna_abatimento_id AS estornaAbatimentoId FROM abatimentos_parcela WHERE parcela_id=? ORDER BY id`,
            id,
          ),
        };
      });
    },
    obterVenda(input: unknown): VendaFinanceira {
      return read(() => {
        const id = identifier(input),
          d = sale(id),
          f = resumoFinanceiro(db, id);
        const obrigacoesAtivasCentavos = total(
          db,
          `SELECT r.valor_centavos AS valor FROM reembolsos_cliente r JOIN documentos x ON x.id=r.documento_correcao_id WHERE x.documento_origem_id=? AND x.estado='CONFIRMADO'`,
          id,
        );
        return {
          ...link(d),
          dataComercial: d.dataComercial,
          resumo: {
            ...f,
            recebidoLiquidoCentavos: f.recebimentosEfetivosCentavos - f.estornosRecebimentoCentavos,
            reembolsoPagoLiquidoCentavos: f.reembolsosPagosCentavos - f.estornosReembolsoCentavos,
            obrigacoesAtivasCentavos,
          },
        };
      });
    },
    listarMovimentos(input: unknown) {
      return read(() => {
        const v = record(input, ['vendaId', 'aposId', 'limite', 'parcelaId', 'reembolsoId']);
        const id = identifier(v['vendaId']);
        sale(id);
        const { limite } = page(v),
          after =
            v['aposId'] === undefined
              ? 0
              : integer(v['aposId'], 'aposId', 0, Number.MAX_SAFE_INTEGER);
        const p = optionalId(v['parcelaId']),
          r = optionalId(v['reembolsoId']);
        if ((p && parcela(p, today()).vendaId !== id) || (r && refund(r).vendaId !== id)) missing();
        const rows = all<MovimentoConsultaFinanceiro>(
          `${movementSql} WHERE m.documento_id=? AND m.id>? AND (? IS NULL OR EXISTS(SELECT 1 FROM alocacoes_recebimento a WHERE a.movimento_financeiro_id=m.id AND a.parcela_id=?)) AND (? IS NULL OR EXISTS(SELECT 1 FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id WHERE a.movimento_financeiro_id=m.id AND o.reembolso_id=?)) ORDER BY m.id LIMIT ?`,
          id,
          after,
          p,
          p,
          r,
          r,
          limite + 1,
        );
        return slice(rows, limite, today());
      });
    },
    obterMovimento(input: unknown): DetalheMovimentoFinanceiro {
      return read(() => {
        const v = record(input, ['vendaId', 'movimentoId']),
          id = identifier(v['movimentoId']);
        const m = movement(id, identifier(v['vendaId']));
        return {
          ...m,
          alocacoes: all(
            `SELECT id,natureza,valor_centavos AS valorCentavos,parcela_id AS parcelaId,NULL AS reembolsoId,estorna_alocacao_id AS estornaAlocacaoId FROM alocacoes_recebimento WHERE movimento_financeiro_id=? UNION ALL SELECT a.id,a.natureza,a.valor_centavos,NULL,o.reembolso_id,a.estorna_alocacao_id FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id WHERE a.movimento_financeiro_id=? ORDER BY id`,
            id,
            id,
          ),
        };
      });
    },
    listarReembolsos(input: unknown) {
      return read(() => {
        const v = record(input, [...filterKeys, 'situacao']),
          { limite, deslocamento } = page(v);
        const cliente = optionalId(v['clienteId']),
          venda = optionalId(v['vendaId']);
        const state = (v['situacao'] ?? 'ATIVAS') as ConsultaReembolsos['situacao'];
        const predicates = {
          ATIVAS: "estado='CONFIRMADO'",
          PENDENTES: "estado='CONFIRMADO' AND saldo>0",
          QUITADAS: "estado='CONFIRMADO' AND saldo=0",
          ANULADAS: "estado='ESTORNADO'",
          TODAS: '1=1',
        };
        if (!state || !Object.hasOwn(predicates, state)) invalid();
        const rows = db
          .prepare(
            `WITH base AS (SELECT r.id,x.estado,x.data_comercial,r.valor_centavos-coalesce((SELECT sum(CASE a.natureza WHEN 'PAGAMENTO' THEN a.valor_centavos ELSE -a.valor_centavos END) FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id WHERE o.reembolso_id=r.id),0) AS saldo FROM reembolsos_cliente r JOIN documentos x ON x.id=r.documento_correcao_id JOIN documentos d ON d.id=x.documento_origem_id WHERE ${allowedSale} AND (@cliente IS NULL OR d.cliente_id=@cliente) AND (@venda IS NULL OR d.id=@venda)) SELECT id FROM base WHERE ${predicates[state!]} ORDER BY data_comercial,id LIMIT @limite OFFSET @offset`,
          )
          .all({ cliente, venda, limite: limite + 1, offset: deslocamento }) as { id: number }[];
        return slice(
          rows.map((r) => refund(r.id)),
          limite,
          today(),
        );
      });
    },
    obterReembolso(input: unknown): DetalheReembolso {
      return read(() => {
        const v = record(input, ['vendaId', 'reembolsoId']),
          id = identifier(v['reembolsoId']),
          r = refund(id);
        if (r.vendaId !== identifier(v['vendaId'])) missing();
        return {
          ...r,
          dataReferencia: today(),
          origens: all(
            `SELECT a.movimento_financeiro_id AS movimentoId,a.parcela_id AS parcelaId,o.valor_centavos AS valorCentavos FROM origens_reembolso o JOIN alocacoes_recebimento a ON a.id=o.alocacao_recebimento_id WHERE o.reembolso_id=? ORDER BY o.id`,
            id,
          ),
        };
      });
    },
    obterContextoVenda(input: unknown): ContextoVendaConsulta {
      return read(() => {
        const id = identifier(input),
          d = sale(id);
        const rows = all<{
          id: number;
          produtoId: number;
          descricaoHistorica: string;
          quantidadeOriginal: number;
          skuHistorico: string;
          valorLiquidoCentavos: number;
        }>(
          `SELECT id,produto_id AS produtoId,descricao_historica AS descricaoHistorica,sku_historico AS skuHistorico,valor_liquido_centavos AS valorLiquidoCentavos,quantidade AS quantidadeOriginal FROM itens_documento WHERE documento_id=? ORDER BY sequencia`,
          id,
        );
        return {
          ...link(d),
          dataComercial: d.dataComercial,
          cancelavel:
            d.vendaEstado === 'CONFIRMADO' &&
            !get(
              "SELECT id FROM documentos WHERE documento_origem_id=? AND estado='CONFIRMADO'",
              id,
            ),
          itens: rows.map((i) => {
            const quantidadeDevolvida = total(
              db,
              `SELECT i.quantidade AS valor FROM itens_documento i JOIN documentos x ON x.id=i.documento_id WHERE i.item_origem_id=? AND x.estado='CONFIRMADO'`,
              i.id,
            );
            return {
              ...i,
              quantidadeDevolvida,
              quantidadeDisponivel: i.quantidadeOriginal - quantidadeDevolvida,
            };
          }),
        };
      });
    },
    listarDocumentos(input: unknown) {
      return read(() => {
        const v = record(input, [...pageKeys, 'vendaId']),
          id = identifier(v['vendaId']);
        sale(id);
        const { limite, deslocamento } = page(v);
        const rows = all<{ id: number }>(
          `${correctionSql} AND d.id=? ORDER BY x.id DESC LIMIT ? OFFSET ?`,
          id,
          limite + 1,
          deslocamento,
        );
        return slice(
          rows.map((r) => correction(r.id, id)),
          limite,
          today(),
        );
      });
    },
    obterDocumento(input: unknown): DetalheCorrecao {
      return read(() => {
        const v = record(input, ['vendaId', 'documentoId']),
          id = identifier(v['documentoId']),
          d = correction(id, identifier(v['vendaId']));
        return {
          ...d,
          itens: all(
            `SELECT id,item_origem_id AS itemOrigemId,produto_id AS produtoId,descricao_historica AS descricaoHistorica,sku_historico AS skuHistorico,quantidade,quantidade_perda AS quantidadePerda,valor_liquido_centavos AS valorLiquidoCentavos,valor_custo_estoque_centavos AS custoHistoricoCentavos FROM itens_documento WHERE documento_id=? ORDER BY sequencia`,
            id,
          ),
          movimentosEstoque: all(
            `SELECT m.id,m.produto_id AS produtoId,m.natureza,m.quantidade_delta AS quantidadeDelta,m.valor_delta_centavos AS valorDeltaCentavos,m.movimentacao_origem_id AS origemId FROM movimentacoes_estoque m JOIN vinculos_estoque_comercial v ON v.movimentacao_id=m.id JOIN itens_documento i ON i.id=v.item_documento_id WHERE i.documento_id=? ORDER BY m.id`,
            id,
          ),
          abatimentos: all(
            `SELECT parcela_id AS parcelaId,natureza,valor_centavos AS valorCentavos FROM abatimentos_parcela WHERE documento_correcao_id=? ORDER BY id`,
            id,
          ),
          reembolsoIds: all<{ id: number }>(
            'SELECT id FROM reembolsos_cliente WHERE documento_correcao_id=? ORDER BY id',
            id,
          ).map((r) => r.id),
        };
      });
    },
  };
}
