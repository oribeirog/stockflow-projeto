import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type {
  CodigoErroComercial,
  DadosConfirmacao,
  DadosRascunho,
  Desconto,
  DocumentoComercial,
  ItemComercial,
  PagamentoConfirmacao,
  ParcelaPlanejada,
  ParcelaReceber,
} from '../../shared/comercial';
import { descontoCentavos, dinheiro, ratear, somar } from '../domain/comercial';
import { custoSaida } from '../domain/custeio';
import {
  CadastroError,
  canonical,
  identifier,
  integer,
  optionalText,
  record,
  text,
} from './catalog-validation';
import { effectiveDate, EstoqueError } from './estoque-validation';
import { createCatalogService } from './catalogos';
import { aplicarMovimentoNaTransacao } from './estoque';
import { resumoFinanceiro } from './financeiro';
import { reconciliarFinanceiro } from './financeiro-reconciliation';

export class ComercialError extends Error {
  constructor(
    public readonly code: CodigoErroComercial,
    message: string,
  ) {
    super(message);
  }
}
const fail = (message: string): never => {
  throw new ComercialError('VALIDATION', message);
};
const money = (value: unknown) => integer(value, 'centavos', 0, 9_000_000_000_000);
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('Lista inválida.');
  return value as unknown[];
}
function discount(value: unknown): Desconto | undefined {
  if (value === undefined) return undefined;
  const d = record(value, ['tipo', 'valor']);
  if (d['tipo'] !== 'CENTAVOS' && d['tipo'] !== 'PONTOS_BASE') fail('Tipo de desconto inválido.');
  return {
    tipo: d['tipo'] as Desconto['tipo'],
    valor: integer(d['valor'], 'desconto', 0, d['tipo'] === 'CENTAVOS' ? 9_000_000_000_000 : 10000),
  };
}
export function commercialDate(value: unknown): string {
  const date = text(value, 'data', 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    fail('Data inválida.');
  return date;
}
function normalizeDraft(input: unknown, now: Date): DadosRascunho {
  const v = record(input, [
    'id',
    'versaoEsperada',
    'tipo',
    'clienteId',
    'fornecedorId',
    'modalidadeVenda',
    'dataComercial',
    'itens',
    'descontoGlobal',
    'freteCentavos',
    'despesasDiretasCentavos',
    'observacoes',
  ]);
  if (v['tipo'] !== 'COMPRA' && v['tipo'] !== 'VENDA') fail('Tipo inválido.');
  const mode = v['modalidadeVenda'] ?? null;
  if (mode !== null && mode !== 'A_VISTA' && mode !== 'A_PRAZO') fail('Modalidade inválida.');
  const result: DadosRascunho = {
    id: v['id'] === undefined ? undefined : identifier(v['id']),
    versaoEsperada: v['id'] === undefined ? undefined : identifier(v['versaoEsperada']),
    tipo: v['tipo'] as DadosRascunho['tipo'],
    clienteId: v['clienteId'] == null ? null : identifier(v['clienteId']),
    fornecedorId: v['fornecedorId'] == null ? null : identifier(v['fornecedorId']),
    modalidadeVenda: mode as DadosRascunho['modalidadeVenda'],
    dataComercial: effectiveDate(v['dataComercial'], now),
    itens: array(v['itens'], 1000).map((input) => {
      const i = record(input, [
        'produtoId',
        'quantidade',
        'valorUnitarioCentavos',
        'desconto',
        'motivo',
      ]);
      return {
        produtoId: identifier(i['produtoId']),
        quantidade: integer(i['quantidade'], 'quantidade', 1, 1_000_000_000),
        valorUnitarioCentavos: money(i['valorUnitarioCentavos']),
        desconto: discount(i['desconto']),
        motivo: optionalText(i['motivo'], 'motivo', 4000),
      };
    }),
    descontoGlobal: discount(v['descontoGlobal']),
    freteCentavos: money(v['freteCentavos'] ?? 0),
    despesasDiretasCentavos: money(v['despesasDiretasCentavos'] ?? 0),
    observacoes: optionalText(v['observacoes'], 'observacoes', 4000),
  };
  if (v['id'] === undefined && v['versaoEsperada'] !== undefined) fail('Versão sem documento.');
  if (new Set(result.itens.map((i) => i.produtoId)).size !== result.itens.length)
    fail('Produto repetido.');
  if (
    result.tipo === 'COMPRA'
      ? result.clienteId !== null || mode !== null
      : result.fornecedorId !== null ||
        result.freteCentavos !== 0 ||
        result.despesasDiretasCentavos !== 0
  )
    fail('Campos incompatíveis com o documento.');
  return result;
}
function normalizeConfirmation(input: unknown): DadosConfirmacao {
  const v = record(input, ['id', 'versaoEsperada', 'pagamentos', 'parcelas']);
  const payments = new Map<number, number>();
  for (const raw of array(v['pagamentos'] ?? [], 200)) {
    const p = record(raw, ['formaPagamentoId', 'valorCentavos']);
    const id = identifier(p['formaPagamentoId']),
      value = money(p['valorCentavos']);
    if (!value) fail('Pagamento deve ser positivo.');
    payments.set(id, somar([payments.get(id) ?? 0, value]));
  }
  return {
    id: identifier(v['id']),
    versaoEsperada: identifier(v['versaoEsperada']),
    pagamentos: [...payments]
      .sort(([a], [b]) => a - b)
      .map(([formaPagamentoId, valorCentavos]) => ({ formaPagamentoId, valorCentavos })),
    parcelas: array(v['parcelas'] ?? [], 1000).map((raw) => {
      const p = record(raw, ['valorCentavos', 'vencimento']);
      const valorCentavos = money(p['valorCentavos']);
      if (!valorCentavos) fail('Parcela deve ser positiva.');
      return { valorCentavos, vencimento: commercialDate(p['vencimento']) };
    }),
  };
}
const documentFields = `id,numero,tipo,estado,versao,cliente_id AS clienteId,fornecedor_id AS fornecedorId,
  contraparte_nome AS contraparteNome,contraparte_documento AS contraparteDocumento,modalidade_venda AS modalidadeVenda,
  data_comercial AS dataComercial,subtotal_centavos AS subtotalCentavos,desconto_itens_centavos AS descontoItensCentavos,
  desconto_global_centavos AS descontoGlobalCentavos,frete_centavos AS freteCentavos,despesas_diretas_centavos AS despesasDiretasCentavos,
  total_centavos AS totalCentavos,observacoes,criado_em AS criadoEm,confirmado_em AS confirmadoEm,operacao_confirmacao_id AS operacaoConfirmacaoId`;
const itemFields = `id,sequencia,produto_id AS produtoId,sku_historico AS skuHistorico,descricao_historica AS descricaoHistorica,
  quantidade,valor_unitario_centavos AS valorUnitarioCentavos,valor_bruto_centavos AS valorBrutoCentavos,
  desconto_item_centavos AS descontoItemCentavos,desconto_global_rateado_centavos AS descontoGlobalRateadoCentavos,
  frete_rateado_centavos AS freteRateadoCentavos,despesas_rateadas_centavos AS despesasRateadasCentavos,
  valor_liquido_centavos AS valorLiquidoCentavos,valor_custo_estoque_centavos AS valorCustoEstoqueCentavos,motivo`;

export function createCommercialService(
  db: Database.Database,
  appVersion: string,
  clock: () => Date = () => new Date(),
) {
  const catalog = createCatalogService(db, appVersion);
  function read(id: number): DocumentoComercial {
    const row = db.prepare(`SELECT ${documentFields} FROM documentos WHERE id=?`).get(id) as
      | DocumentoComercial
      | undefined;
    if (!row) throw new ComercialError('NOT_FOUND', 'Documento não encontrado.');
    const itens = db
      .prepare(`SELECT ${itemFields} FROM itens_documento WHERE documento_id=? ORDER BY sequencia`)
      .all(id) as ItemComercial[];
    const parcelas = db
      .prepare(
        'SELECT id,numero,valor_original_centavos AS valorOriginalCentavos,vencimento FROM parcelas_receber WHERE venda_id=? ORDER BY numero',
      )
      .all(id) as ParcelaReceber[];
    const received = db
      .prepare(
        "SELECT valor_centavos AS valor FROM movimentos_financeiros WHERE documento_id=? AND natureza='RECEBIMENTO_CLIENTE'",
      )
      .all(id) as { valor: number }[];
    const recebimentosEfetivosCentavos = somar(received.map((r) => r.valor));
    return {
      ...row,
      itens,
      parcelas,
      recebimentosEfetivosCentavos,
      saldoReceberCentavos:
        (db.pragma('user_version', { simple: true }) as number) >= 4 &&
        row.tipo === 'VENDA' &&
        row.estado === 'CONFIRMADO'
          ? resumoFinanceiro(db, id).saldoReceberCentavos
          : row.tipo === 'VENDA' && row.estado === 'CONFIRMADO'
            ? dinheiro(BigInt(row.totalCentavos) - BigInt(recebimentosEfetivosCentavos))
            : 0,
    };
  }
  function handle<T>(action: () => T): T {
    try {
      return action();
    } catch (error) {
      if (error instanceof ComercialError) throw error;
      if (error instanceof CadastroError)
        throw new ComercialError(
          error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION',
          error.message,
        );
      if (error instanceof EstoqueError) throw new ComercialError(error.code, error.message);
      if (error instanceof RangeError) throw new ComercialError('VALIDATION', error.message);
      const code = (error as { code?: string }).code;
      if (code?.startsWith('SQLITE_BUSY') || code?.startsWith('SQLITE_LOCKED'))
        throw new ComercialError('BUSY', 'Banco ocupado; tente novamente com a mesma chave.');
      if (
        code?.startsWith('SQLITE_CONSTRAINT') ||
        code === 'SQLITE_TOOBIG' ||
        code === 'SQLITE_ERROR'
      )
        throw new ComercialError('INTEGRITY', 'Restrição de integridade comercial.');
      throw error;
    }
  }
  function write<T>(
    kind: string,
    command: unknown,
    normalize: (data: unknown, now: Date) => T,
    action: (data: T, op: string, reason: string, now: string) => DocumentoComercial,
  ): DocumentoComercial {
    return handle(() => {
      const e = record(command, ['operacaoId', 'motivo', 'dados']);
      const op = text(e['operacaoId'], 'operacaoId', 100),
        reason = text(e['motivo'], 'motivo', 4000);
      if (!/^[A-Za-z0-9_-]+$/.test(op)) fail('Chave inválida.');
      const now = clock(),
        data = normalize(e['dados'], now);
      const hash = createHash('sha256')
        .update(canonical({ version: 1, kind, data, reason }))
        .digest('hex');
      return db
        .transaction(() => {
          const previous = db
            .prepare('SELECT tipo,hash_entrada,resultado_json FROM operacoes WHERE id=?')
            .get(op) as { tipo: string; hash_entrada: string; resultado_json: string } | undefined;
          if (previous) {
            if (previous.tipo !== kind || previous.hash_entrada !== hash)
              throw new ComercialError('IDEMPOTENCY_CONFLICT', 'Chave usada com outro conteúdo.');
            if (previous.resultado_json === 'null')
              throw new ComercialError('INTEGRITY', 'Operação incompleta.');
            return JSON.parse(previous.resultado_json) as DocumentoComercial;
          }
          db.prepare('INSERT INTO operacoes VALUES (?,?,?,?,?)').run(
            op,
            kind,
            hash,
            'null',
            now.toISOString(),
          );
          const existingId = (data as { id?: number }).id;
          const before = existingId === undefined ? null : read(existingId);
          const result = action(data, op, reason, now.toISOString());
          db.prepare(
            `INSERT INTO eventos_auditoria (operacao_id,documento_id,cliente_id,fornecedor_id,evento,motivo,antes_json,depois_json,registrado_em,versao_aplicativo)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            op,
            result.id,
            result.clienteId,
            result.fornecedorId,
            kind,
            reason,
            before === null ? null : JSON.stringify(before),
            JSON.stringify(result),
            now.toISOString(),
            appVersion,
          );
          db.prepare('UPDATE operacoes SET resultado_json=? WHERE id=?').run(
            JSON.stringify(result),
            op,
          );
          if (
            (db.pragma('user_version', { simple: true }) as number) >= 4 &&
            !reconciliarFinanceiro(db)
          )
            throw new ComercialError(
              'INTEGRITY',
              'Reconciliação financeira falhou; operação desfeita.',
            );
          return result;
        })
        .immediate();
    });
  }
  function draft(id: number, version: number) {
    const d = read(id);
    if (d.estado !== 'RASCUNHO')
      throw new ComercialError('INVALID_STATE', 'Documento não é rascunho.');
    if (d.versao !== version)
      throw new ComercialError('VERSION_CONFLICT', 'Rascunho mudou; consulte novamente.');
    if (d.operacaoConfirmacaoId !== null)
      throw new ComercialError('INTEGRITY', 'Confirmação incompleta.');
    return d;
  }
  function active(value: { ativo: boolean }) {
    if (!value.ativo) throw new ComercialError('INACTIVE_REFERENCE', 'Cadastro inativo.');
  }
  function save(data: DadosRascunho, _op: string, _reason: string, now: string) {
    if (data.fornecedorId) catalog.getPerson('FORNECEDOR', data.fornecedorId);
    if (data.clienteId) catalog.getPerson('CLIENTE', data.clienteId);
    for (const item of data.itens) catalog.getProduct(item.produtoId);
    const bruto = data.itens.map((i) =>
      dinheiro(BigInt(i.quantidade) * BigInt(i.valorUnitarioCentavos)),
    );
    const discounts = data.itens.map((i, n) => descontoCentavos(bruto[n], i.desconto));
    const bases = bruto.map((n, i) => n - discounts[i]);
    const global = descontoCentavos(somar(bases), data.descontoGlobal);
    const globals = ratear(global, bases),
      liquids = bases.map((n, i) => n - globals[i]);
    const shippingBases = somar(liquids) === 0 ? data.itens.map((i) => i.quantidade) : liquids;
    const shipping = ratear(data.freteCentavos ?? 0, shippingBases),
      expenses = ratear(data.despesasDiretasCentavos ?? 0, shippingBases);
    const totals = [
      somar(bruto),
      somar(discounts),
      global,
      data.freteCentavos ?? 0,
      data.despesasDiretasCentavos ?? 0,
      somar([...liquids, data.freteCentavos ?? 0, data.despesasDiretasCentavos ?? 0]),
    ];
    const values = [
      data.clienteId,
      data.fornecedorId,
      data.modalidadeVenda,
      data.dataComercial,
      ...totals,
      data.observacoes,
    ];
    let id: number;
    if (data.id) {
      const before = draft(data.id, data.versaoEsperada!);
      if (before.tipo !== data.tipo) fail('Tipo do documento é imutável.');
      id = data.id;
      db.prepare(
        `UPDATE documentos SET cliente_id=?,fornecedor_id=?,modalidade_venda=?,data_comercial=?,
        subtotal_centavos=?,desconto_itens_centavos=?,desconto_global_centavos=?,frete_centavos=?,despesas_diretas_centavos=?,total_centavos=?,observacoes=?,versao=versao+1 WHERE id=?`,
      ).run(...values, id);
      db.prepare('DELETE FROM itens_documento WHERE documento_id=?').run(id);
    } else {
      // IMMEDIATE serializes the AUTOINCREMENT high-water mark and generated number.
      const next = db
        .prepare(
          "SELECT coalesce((SELECT seq FROM sqlite_sequence WHERE name='documentos'),0)+1 AS id",
        )
        .get() as { id: number };
      id = integer(next.id, 'id', 1, Number.MAX_SAFE_INTEGER);
      db.prepare(
        `INSERT INTO documentos (numero,tipo,estado,versao,cliente_id,fornecedor_id,modalidade_venda,data_comercial,
        subtotal_centavos,desconto_itens_centavos,desconto_global_centavos,frete_centavos,despesas_diretas_centavos,total_centavos,observacoes,criado_em)
        VALUES (?,?,'RASCUNHO',1,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(`${data.tipo}-${id}`, data.tipo, ...values, now);
    }
    const insert =
      db.prepare(`INSERT INTO itens_documento (documento_id,sequencia,produto_id,quantidade,valor_unitario_centavos,valor_bruto_centavos,
      desconto_item_centavos,desconto_global_rateado_centavos,frete_rateado_centavos,despesas_rateadas_centavos,valor_liquido_centavos,valor_custo_estoque_centavos,motivo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`);
    data.itens.forEach((i, n) =>
      insert.run(
        id,
        n + 1,
        i.produtoId,
        i.quantidade,
        i.valorUnitarioCentavos,
        bruto[n],
        discounts[n],
        globals[n],
        shipping[n],
        expenses[n],
        liquids[n],
        i.motivo,
      ),
    );
    return read(id);
  }
  function confirm(
    data: DadosConfirmacao,
    op: string,
    reason: string,
    now: string,
    entrada = false,
  ) {
    const d = draft(data.id, data.versaoEsperada);
    effectiveDate(d.dataComercial, clock());
    if (!d.itens.length) fail('Confirmação exige itens.');
    let person: { nome: string; documento: string | null } | null = null;
    if (d.tipo === 'COMPRA') {
      if (!d.fornecedorId) fail('Compra exige fornecedor.');
      const supplier = catalog.getPerson('FORNECEDOR', d.fornecedorId!);
      active(supplier);
      person = supplier;
    } else {
      if (!d.modalidadeVenda) fail('Venda exige modalidade.');
      if (d.modalidadeVenda === 'A_PRAZO' && !d.clienteId) fail('Venda a prazo exige cliente.');
      if (d.clienteId) {
        const client = catalog.getPerson('CLIENTE', d.clienteId);
        active(client);
        person = client;
      }
    }
    const payments = data.pagamentos ?? [],
      planned = data.parcelas ?? [];
    const paidNow = d.tipo === 'COMPRA' || d.modalidadeVenda === 'A_VISTA';
    const initial = somar(payments.map((p) => p.valorCentavos));
    if (entrada && (paidNow || initial <= 0 || initial >= d.totalCentavos))
      fail('Entrada exige venda a prazo e saldo futuro positivo.');
    if (!entrada && initial !== (paidNow ? d.totalCentavos : 0))
      fail('Pagamentos não correspondem ao total.');
    const forms = payments.map((p) => {
      const f = catalog.getReference('FORMA_PAGAMENTO', p.formaPagamentoId);
      active(f);
      return f;
    });
    let parcels: ParcelaPlanejada[] = [];
    if (d.tipo === 'VENDA' && d.modalidadeVenda === 'A_PRAZO') {
      if (
        somar(planned.map((p) => p.valorCentavos)) !== d.totalCentavos - (entrada ? initial : 0) ||
        planned.some((p) => p.vencimento < d.dataComercial)
      )
        fail('Parcelamento inválido.');
      parcels = entrada
        ? [{ valorCentavos: initial, vencimento: d.dataComercial }, ...planned]
        : planned;
      if (parcels.length > 1000) fail('Limite de parcelas excedido.');
    } else if (planned.length) fail('Parcelamento informado em operação incompatível.');
    if (d.tipo === 'VENDA' && d.modalidadeVenda === 'A_VISTA' && d.totalCentavos > 0)
      parcels = [{ valorCentavos: d.totalCentavos, vencimento: d.dataComercial }];
    // Validate every product and capture costs before the first stock write.
    for (const item of d.itens) {
      const product = catalog.getProduct(item.produtoId);
      active(product);
      let cost: number;
      if (d.tipo === 'COMPRA') {
        cost = somar([
          item.valorLiquidoCentavos,
          item.freteRateadoCentavos,
          item.despesasRateadasCentavos,
        ]);
        if (cost === 0 && !item.motivo) fail('Bonificação exige motivo no item.');
      } else {
        const balance = db
          .prepare(
            'SELECT quantidade,valor_total_centavos AS valor FROM saldos_estoque WHERE produto_id=?',
          )
          .get(item.produtoId) as { quantidade: number; valor: number } | undefined;
        if (!balance) throw new ComercialError('INTEGRITY', 'Saldo ausente.');
        if (balance.quantidade < item.quantidade)
          throw new ComercialError('INSUFFICIENT_STOCK', 'Estoque insuficiente.');
        cost = dinheiro(
          custoSaida(BigInt(balance.valor), BigInt(balance.quantidade), BigInt(item.quantidade)),
        );
        if (item.valorLiquidoCentavos < cost && !item.motivo)
          throw new ComercialError('BELOW_COST', 'Venda abaixo do custo exige motivo por item.');
      }
      db.prepare(
        'UPDATE itens_documento SET sku_historico=?,descricao_historica=?,valor_custo_estoque_centavos=? WHERE id=?',
      ).run(product.sku, product.nome, cost, item.id);
      item.valorCustoEstoqueCentavos = cost;
    }
    db.prepare(
      'UPDATE documentos SET operacao_confirmacao_id=?,contraparte_nome=?,contraparte_documento=?,versao=versao+1 WHERE id=?',
    ).run(op, person?.nome ?? null, person?.documento ?? null, d.id);
    for (const item of d.itens) {
      const m = aplicarMovimentoNaTransacao(db, {
        produtoId: item.produtoId,
        natureza: d.tipo === 'COMPRA' ? 'COMPRA' : 'VENDA',
        quantidade: item.quantidade,
        custoTotalCentavos: d.tipo === 'COMPRA' ? item.valorCustoEstoqueCentavos : undefined,
        movimentacaoOrigemId: null,
        operacaoId: op,
        motivo: item.motivo ?? reason,
        dataEfetiva: d.dataComercial,
        registradoEm: now,
      });
      db.prepare('INSERT INTO vinculos_estoque_comercial VALUES (?,?)').run(
        m.movimentacaoId,
        item.id,
      );
    }
    const parcelIds = parcels.map((p, i) =>
      Number(
        db
          .prepare(
            `INSERT INTO parcelas_receber (venda_id,numero,valor_original_centavos,vencimento,criado_em${entrada ? ',tipo' : ''}) VALUES (?,?,?,?,?${entrada ? ",'" + (i === 0 ? 'ENTRADA' : 'REGULAR') + "'" : ''})`,
          )
          .run(d.id, i + 1, p.valorCentavos, p.vencimento, now).lastInsertRowid,
      ),
    );
    payments.forEach((p, i) => registerPayment(d, p, forms[i].nome, op, now, parcelIds));
    db.prepare(
      "UPDATE documentos SET estado='CONFIRMADO',confirmado_em=?,versao=versao+1 WHERE id=?",
    ).run(now, d.id);
    return read(d.id);
  }
  function registerPayment(
    d: DocumentoComercial,
    p: PagamentoConfirmacao,
    name: string,
    op: string,
    now: string,
    parcelIds: number[],
  ) {
    const id = db
      .prepare(
        `INSERT INTO movimentos_financeiros (documento_id,natureza,sentido,valor_centavos,forma_pagamento_id,forma_pagamento_historica,data_efetiva,registrado_em,operacao_id)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        d.id,
        d.tipo === 'COMPRA' ? 'PAGAMENTO_COMPRA' : 'RECEBIMENTO_CLIENTE',
        d.tipo === 'COMPRA' ? 'SAIDA' : 'ENTRADA',
        p.valorCentavos,
        p.formaPagamentoId,
        name,
        d.dataComercial,
        now,
        op,
      ).lastInsertRowid;
    if (d.tipo === 'VENDA')
      db.prepare(
        'INSERT INTO alocacoes_recebimento (movimento_financeiro_id,parcela_id,valor_centavos) VALUES (?,?,?)',
      ).run(id, parcelIds[0], p.valorCentavos);
  }
  return {
    salvarRascunho: (command: unknown) => write('COMERCIAL_SALVAR', command, normalizeDraft, save),
    confirmar: (command: unknown) =>
      write('COMERCIAL_CONFIRMAR', command, normalizeConfirmation, confirm),
    confirmarComEntrada: (command: unknown) =>
      write(
        'COMERCIAL_CONFIRMAR_ENTRADA',
        command,
        normalizeConfirmation,
        (data, op, reason, now) => confirm(data, op, reason, now, true),
      ),
    descartarRascunho: (command: unknown) =>
      write(
        'COMERCIAL_DESCARTAR',
        command,
        (input) => {
          const v = record(input, ['id', 'versaoEsperada']);
          return { id: identifier(v['id']), versaoEsperada: identifier(v['versaoEsperada']) };
        },
        (data) => {
          draft(data.id, data.versaoEsperada);
          db.prepare("UPDATE documentos SET estado='DESCARTADO',versao=versao+1 WHERE id=?").run(
            data.id,
          );
          return read(data.id);
        },
      ),
    consultar: (input: unknown) => handle(() => db.transaction(() => read(identifier(input)))()),
    listar: (input: unknown = {}) =>
      handle(() => {
        const f = record(input, ['aposId', 'limite']);
        const after =
            f['aposId'] === undefined
              ? 0
              : integer(f['aposId'], 'aposId', 0, Number.MAX_SAFE_INTEGER),
          limit = f['limite'] === undefined ? 50 : integer(f['limite'], 'limite', 1, 200);
        return db.transaction(() =>
          (
            db
              .prepare('SELECT id FROM documentos WHERE id>? ORDER BY id LIMIT ?')
              .all(after, limit) as { id: number }[]
          ).map((r) => read(r.id)),
        )();
      }),
  };
}
