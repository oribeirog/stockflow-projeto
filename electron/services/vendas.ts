import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type {
  PlanoVenda,
  RevisaoVenda,
  Venda,
  PaginaVendas,
  PagamentoVenda,
} from '../../shared/vendas-ipc';
import { createCommercialService, ComercialError, commercialDate } from './comercial';
import { createFinancialService } from './financeiro';
import { createCatalogService } from './catalogos';
import { canonical, identifier, integer, record, text } from './catalog-validation';
import { dividirParcelas, somar, dinheiro } from '../domain/comercial';
import { custoSaida } from '../domain/custeio';

const fail = (message: string): never => {
  throw new ComercialError('VALIDATION', message);
};
const list = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) fail('Lista inválida.');
  return v as unknown[];
};
export function createSalesService(db: Database.Database, version: string) {
  const commercial = createCommercialService(db, version),
    financial = createFinancialService(db, version),
    catalog = createCatalogService(db, version);
  function sale(input: unknown) {
    const id = identifier(input);
    if (!db.prepare("SELECT id FROM documentos WHERE id=? AND tipo='VENDA'").get(id))
      throw new ComercialError('NOT_FOUND', 'Venda não encontrada.');
    return commercial.consultar(id);
  }
  function detail(input: unknown): Venda {
    const d = sale(input);
    if (d.estado === 'RASCUNHO') {
      const p = d.clienteId ? catalog.getPerson('CLIENTE', d.clienteId) : null;
      d.contraparteNome = p?.nome ?? null;
      d.contraparteDocumento = p?.documento ?? null;
      for (const i of d.itens) {
        const p = catalog.getProduct(i.produtoId);
        i.descricaoHistorica = p.nome;
        i.skuHistorico = p.sku;
      }
    }
    const pagamentos = db
      .prepare(
        "SELECT id,forma_pagamento_id AS formaPagamentoId,forma_pagamento_historica AS nomeHistorico,valor_centavos AS valorCentavos,data_efetiva AS dataEfetiva,registrado_em AS registradoEm FROM movimentos_financeiros WHERE documento_id=? AND natureza='RECEBIMENTO_CLIENTE' AND operacao_id=? ORDER BY id",
      )
      .all(d.id, d.operacaoConfirmacaoId) as PagamentoVenda[];
    const posted = d.estado === 'CONFIRMADO' || d.estado === 'ESTORNADO';
    const financeiro = posted ? financial.consultarVenda(d.id) : null;
    return {
      ...d,
      saldoReceberCentavos: financeiro?.saldoReceberCentavos ?? d.saldoReceberCentavos,
      pagamentos,
      recebidoConfirmacaoCentavos: somar(pagamentos.map((p) => p.valorCentavos)),
      financeiro,
      parcelasFinanceiras: posted ? financial.listarParcelas(d.id) : [],
    };
  }
  function normalize(input: unknown): PlanoVenda {
    const v = record(input, [
      'id',
      'versaoEsperada',
      'pagamentos',
      'parcelas',
      'comEntrada',
      'dividir',
    ]);
    if (typeof v['comEntrada'] !== 'boolean') fail('Entrada inválida.');
    return {
      id: identifier(v['id']),
      versaoEsperada: identifier(v['versaoEsperada']),
      comEntrada: v['comEntrada'] as boolean,
      pagamentos: list(v['pagamentos'] ?? [], 200).map((raw) => {
        const p = record(raw, ['formaPagamentoId', 'valorCentavos']);
        return {
          formaPagamentoId: identifier(p['formaPagamentoId']),
          valorCentavos: integer(p['valorCentavos'], 'valor', 1, 9_000_000_000_000),
        };
      }),
      parcelas: list(v['parcelas'] ?? [], 1000).map((raw) => {
        const p = record(raw, ['valorCentavos', 'vencimento']);
        return {
          valorCentavos: integer(p['valorCentavos'], 'valor', 1, 9_000_000_000_000),
          vencimento: commercialDate(p['vencimento']),
        };
      }),
    };
  }
  const hash = (p: PlanoVenda) => createHash('sha256').update(canonical(p)).digest('hex');
  function review(input: unknown): RevisaoVenda {
    const p = normalize(input),
      d = sale(p.id);
    if (d.estado !== 'RASCUNHO')
      throw new ComercialError('INVALID_STATE', 'Rascunho indisponível.');
    if (d.versao !== p.versaoEsperada)
      throw new ComercialError('VERSION_CONFLICT', 'Versão mudou.');
    const active = (v: { ativo: boolean }) => {
      if (!v.ativo) throw new ComercialError('INACTIVE_REFERENCE', 'Referência inativa.');
    };
    if (!d.itens.length || !d.modalidadeVenda || (d.modalidadeVenda === 'A_PRAZO' && !d.clienteId))
      fail('Inclua itens, modalidade e cliente a prazo.');
    if (d.clienteId) active(catalog.getPerson('CLIENTE', d.clienteId));
    const received = somar(
      p.pagamentos!.map((v) => {
        active(catalog.getReference('FORMA_PAGAMENTO', v.formaPagamentoId));
        return v.valorCentavos;
      }),
    );
    const cash = d.modalidadeVenda === 'A_VISTA';
    if (
      p.comEntrada
        ? cash || received <= 0 || received >= d.totalCentavos
        : received !== (cash ? d.totalCentavos : 0)
    )
      fail('Pagamentos incompatíveis.');
    const remaining = d.totalCentavos - received;
    const raw = input as Record<string, unknown>;
    if (raw['dividir'] !== undefined) {
      const div = record(raw['dividir'], ['vencimentos']);
      const dates = list(div['vencimentos'], p.comEntrada ? 999 : 1000).map(commercialDate);
      if (cash || p.parcelas!.length) fail('Divisão incompatível.');
      p.parcelas = dividirParcelas(remaining, dates.length).map((valorCentavos, n) => ({
        valorCentavos,
        vencimento: dates[n],
      }));
    }
    if (
      cash
        ? p.parcelas!.length !== 0
        : somar(p.parcelas!.map((v) => v.valorCentavos)) !== remaining ||
          p.parcelas!.length + (p.comEntrada ? 1 : 0) > 1000 ||
          p.parcelas!.some((v) => v.vencimento < d.dataComercial)
    )
      fail('Parcelas incompatíveis.');
    const avisos: string[] = [];
    for (const i of d.itens) {
      active(catalog.getProduct(i.produtoId));
      const b = db
        .prepare(
          'SELECT quantidade,valor_total_centavos AS valor FROM saldos_estoque WHERE produto_id=?',
        )
        .get(i.produtoId) as { quantidade: number; valor: number } | undefined;
      if (!b) throw new ComercialError('INTEGRITY', 'Saldo ausente.');
      if (b.quantidade < i.quantidade)
        throw new ComercialError('INSUFFICIENT_STOCK', 'Estoque insuficiente.');
      if (
        i.valorLiquidoCentavos <
        dinheiro(custoSaida(BigInt(b.valor), BigInt(b.quantidade), BigInt(i.quantidade)))
      ) {
        if (!i.motivo) throw new ComercialError('BELOW_COST', 'Informe motivo por item.');
        avisos.push(
          `Produto ${i.produtoId}: venda abaixo do custo atual, com justificativa. O custo será revalidado na confirmação.`,
        );
      }
    }
    return {
      avisos,
      plano: p,
      revisao: hash(p),
      totalCentavos: d.totalCentavos,
      recebidoConfirmacaoCentavos: received,
      saldoFuturoCentavos: remaining,
    };
  }
  function write(
    action: 'salvarRascunho' | 'confirmar' | 'confirmarComEntrada' | 'descartarRascunho',
    input: unknown,
  ): Venda {
    const e = record(input, ['operacaoId', 'motivo', 'dados']);
    text(e['operacaoId'], 'operacaoId', 100);
    text(e['motivo'], 'motivo', 4000);
    const saving = action === 'salvarRascunho',
      confirming = action === 'confirmar' || action === 'confirmarComEntrada';
    const d = record(
      e['dados'],
      saving
        ? [
            'id',
            'versaoEsperada',
            'clienteId',
            'modalidadeVenda',
            'dataComercial',
            'itens',
            'descontoGlobal',
            'observacoes',
          ]
        : confirming
          ? ['id', 'versaoEsperada', 'pagamentos', 'parcelas', 'revisao']
          : ['id', 'versaoEsperada'],
    );
    return db
      .transaction(() => {
        if (!saving || d['id'] !== undefined) sale(d['id']);
        if (confirming) {
          const p = normalize({
            id: d['id'],
            versaoEsperada: d['versaoEsperada'],
            pagamentos: d['pagamentos'],
            parcelas: d['parcelas'],
            comEntrada: action === 'confirmarComEntrada',
          });
          if (text(d['revisao'], 'revisao', 64) !== hash(p))
            fail('Plano alterado. Revise novamente.');
          if (!db.prepare('SELECT id FROM operacoes WHERE id=?').get(e['operacaoId'])) review(p);
        }
        const data = { ...d };
        delete data['revisao'];
        const result = commercial[action]({
          ...e,
          dados: saving ? { ...data, tipo: 'VENDA' } : data,
        });
        // Persisted service replay owns idempotency. Projection is read-only and may reflect later receipts.
        return detail(result.id);
      })
      .immediate();
  }
  return {
    salvarRascunho: (i: unknown) => write('salvarRascunho', i),
    confirmar: (i: unknown) => write('confirmar', i),
    confirmarComEntrada: (i: unknown) => write('confirmarComEntrada', i),
    descartarRascunho: (i: unknown) => write('descartarRascunho', i),
    obter: (i: unknown) => db.transaction(() => detail(i))(),
    revisarPlano: (i: unknown) => db.transaction(() => review(i))(),
    listar: (input: unknown): PaginaVendas => {
      const f = record(input, ['estado', 'clienteId', 'limite', 'deslocamento']),
        state = f['estado'] ?? null;
      if (
        state !== null &&
        !['RASCUNHO', 'CONFIRMADO', 'DESCARTADO', 'ESTORNADO'].includes(state as string)
      )
        fail('Estado inválido.');
      const client = f['clienteId'] === undefined ? null : identifier(f['clienteId']),
        limit = f['limite'] === undefined ? 25 : integer(f['limite'], 'limite', 1, 200),
        offset =
          f['deslocamento'] === undefined
            ? 0
            : integer(f['deslocamento'], 'deslocamento', 0, 1_000_000_000);
      const rows = db
        .prepare(
          "SELECT d.id,d.numero,d.estado,d.cliente_id AS clienteId,CASE WHEN d.estado='RASCUNHO' THEN c.nome ELSE d.contraparte_nome END AS contraparteNome,d.modalidade_venda AS modalidadeVenda,d.data_comercial AS dataComercial,d.total_centavos AS totalCentavos FROM documentos d LEFT JOIN clientes c ON c.id=d.cliente_id WHERE d.tipo='VENDA' AND (? IS NULL OR d.estado=?) AND (? IS NULL OR d.cliente_id=?) ORDER BY d.id DESC LIMIT ? OFFSET ?",
        )
        .all(state, state, client, client, limit + 1, offset) as PaginaVendas['itens'];
      return { itens: rows.slice(0, limit), temMais: rows.length > limit };
    },
  };
}
