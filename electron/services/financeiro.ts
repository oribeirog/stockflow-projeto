import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { ResumoFinanceiro, PagamentoFinanceiro } from '../../shared/financeiro';
import { canonical, identifier, integer, record, text } from './catalog-validation';
import { effectiveDate } from './estoque-validation';
import { dinheiro, somar } from '../domain/comercial';
import { situacaoParcela } from '../domain/correcoes';
import { ComercialError } from './comercial';
import { reconciliarFinanceiro } from './financeiro-reconciliation';

export const one = <T>(db: Database.Database, sql: string, ...params: (string | number)[]) =>
  db.prepare(sql).get(...params) as T | undefined;
export const many = <T>(db: Database.Database, sql: string, ...params: (string | number)[]) =>
  db.prepare(sql).all(...params) as T[];
export const reject = (message: string): never => {
  throw new ComercialError('VALIDATION', message);
};
export function lista(input: unknown, max = 1000): unknown[] {
  if (!Array.isArray(input) || input.length > max) return reject('Lista inválida.');
  return input;
}
export function pagamentos(input: unknown): PagamentoFinanceiro[] {
  const forms = new Map<number, number>();
  for (const raw of lista(input, 200)) {
    const p = record(raw, ['formaPagamentoId', 'valorCentavos']);
    const id = identifier(p['formaPagamentoId']);
    const value = integer(p['valorCentavos'], 'valorCentavos', 1, 9_000_000_000_000);
    forms.set(id, somar([forms.get(id) ?? 0, value]));
  }
  return [...forms]
    .sort(([a], [b]) => a - b)
    .map(([formaPagamentoId, valorCentavos]) => ({ formaPagamentoId, valorCentavos }));
}
export function total(db: Database.Database, sql: string, ...params: (string | number)[]): number {
  const rows = db
    .prepare(sql)
    .safeIntegers()
    .all(...params) as { valor: bigint }[];
  const sum = rows.reduce((v, r) => v + r.valor, 0n);
  if (sum < 0n || sum > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ComercialError('INTEGRITY', 'Total financeiro fora do limite seguro.');
  return Number(sum);
}
export function comandoFinanceiro<T, R>(
  db: Database.Database,
  appVersion: string,
  clock: () => Date,
  kind: string,
  input: unknown,
  normalize: (raw: unknown, now: Date) => T,
  action: (data: T, op: string, reason: string, now: string) => R,
): R {
  try {
    const e = record(input, ['operacaoId', 'motivo', 'dados']);
    const op = text(e['operacaoId'], 'operacaoId', 100),
      reason = text(e['motivo'], 'motivo', 4000);
    if (!/^[A-Za-z0-9_-]+$/.test(op)) reject('Chave inválida.');
    const now = clock(),
      data = normalize(e['dados'], now);
    const hash = createHash('sha256')
      .update(canonical({ version: 1, kind, data, reason }))
      .digest('hex');
    return db
      .transaction(() => {
        const old = one<{ tipo: string; hash_entrada: string; resultado_json: string }>(
          db,
          'SELECT * FROM operacoes WHERE id=?',
          op,
        );
        if (old) {
          if (old.tipo !== kind || old.hash_entrada !== hash)
            throw new ComercialError('IDEMPOTENCY_CONFLICT', 'Chave usada com outro conteúdo.');
          if (old.resultado_json === 'null')
            throw new ComercialError('INTEGRITY', 'Operação incompleta.');
          return JSON.parse(old.resultado_json) as R;
        }
        db.prepare('INSERT INTO operacoes VALUES (?,?,?,?,?)').run(
          op,
          kind,
          hash,
          'null',
          now.toISOString(),
        );
        const ids = data as {
          vendaId?: number;
          documentoId?: number;
          movimentoId?: number;
          reembolsoId?: number;
        };
        const adjustment =
          kind === 'CORRECAO_ESTORNAR_AJUSTE' && ids.movimentoId
            ? one<{ produto_id: number }>(
                db,
                'SELECT * FROM movimentacoes_estoque WHERE id=?',
                ids.movimentoId,
              )
            : undefined;
        const documentId =
          ids.vendaId ??
          ids.documentoId ??
          (ids.movimentoId && kind !== 'CORRECAO_ESTORNAR_AJUSTE'
            ? one<{ documento_id: number }>(
                db,
                'SELECT documento_id FROM movimentos_financeiros WHERE id=?',
                ids.movimentoId,
              )?.documento_id
            : undefined) ??
          (ids.reembolsoId
            ? one<{ documento_origem_id: number }>(
                db,
                'SELECT d.documento_origem_id FROM reembolsos_cliente r JOIN documentos d ON d.id=r.documento_correcao_id WHERE r.id=?',
                ids.reembolsoId,
              )?.documento_origem_id
            : undefined);
        const before = documentId
          ? one<{ tipo: string }>(db, 'SELECT * FROM documentos WHERE id=?', documentId)
          : null;
        const beforeSnapshot =
          before?.tipo === 'VENDA'
            ? {
                documento: before,
                financeiro: resumoFinanceiro(db, documentId!),
                parcelas: parcelasFinanceiras(db, documentId!, localDay(now)),
              }
            : adjustment
              ? {
                  movimento: adjustment,
                  saldo: one(
                    db,
                    'SELECT * FROM saldos_estoque WHERE produto_id=?',
                    adjustment.produto_id,
                  ),
                }
              : before;
        const result = action(data, op, reason, now.toISOString());
        const resultDocument =
          (result as { documentoId?: number }).documentoId ?? documentId ?? null;
        db.prepare(
          'INSERT INTO eventos_auditoria(operacao_id,documento_id,produto_id,evento,motivo,antes_json,depois_json,registrado_em,versao_aplicativo) VALUES (?,?,?,?,?,?,?,?,?)',
        ).run(
          op,
          resultDocument,
          adjustment?.produto_id ?? null,
          kind,
          reason,
          beforeSnapshot ? JSON.stringify(beforeSnapshot) : null,
          JSON.stringify(result),
          now.toISOString(),
          appVersion,
        );
        db.prepare('UPDATE operacoes SET resultado_json=? WHERE id=?').run(
          JSON.stringify(result),
          op,
        );
        if (!reconciliarFinanceiro(db))
          throw new ComercialError(
            'INTEGRITY',
            'Reconciliação financeira falhou; operação desfeita.',
          );
        return result;
      })
      .immediate();
  } catch (e) {
    if (e instanceof ComercialError) throw e;
    const code = (e as { code?: string }).code;
    if (code?.startsWith('SQLITE_BUSY') || code?.startsWith('SQLITE_LOCKED'))
      throw new ComercialError('BUSY', 'Banco ocupado; repita com a mesma chave.');
    if (code?.startsWith('SQLITE_CONSTRAINT'))
      throw new ComercialError('INTEGRITY', 'Restrição de integridade financeira.');
    throw e;
  }
}
export interface ParcelaFinanceira {
  id: number;
  numero: number;
  valorOriginalCentavos: number;
  vencimento: string;
  tipo: 'REGULAR' | 'ENTRADA';
  recebimentosCentavos: number;
  abatimentosCentavos: number;
  saldoCentavos: number;
  status: 'PENDENTE' | 'PARCIALMENTE_PAGO' | 'QUITADO' | 'VENCIDO';
  recebimentoParcial: boolean;
}
export function parcelasFinanceiras(
  db: Database.Database,
  vendaId: number,
  hoje: string,
): ParcelaFinanceira[] {
  return many<ParcelaFinanceira>(
    db,
    'SELECT id,numero,valor_original_centavos AS valorOriginalCentavos,vencimento,tipo FROM parcelas_receber WHERE venda_id=? ORDER BY vencimento,numero,id',
    vendaId,
  ).map((p) => {
    const recebimentosCentavos = total(
      db,
      "SELECT CASE natureza WHEN 'APLICACAO' THEN valor_centavos ELSE -valor_centavos END AS valor FROM alocacoes_recebimento WHERE parcela_id=?",
      p.id,
    );
    const abatimentosCentavos = total(
      db,
      "SELECT CASE natureza WHEN 'ABATIMENTO' THEN valor_centavos ELSE -valor_centavos END AS valor FROM abatimentos_parcela WHERE parcela_id=?",
      p.id,
    );
    return {
      ...p,
      recebimentosCentavos,
      abatimentosCentavos,
      ...situacaoParcela(
        p.valorOriginalCentavos,
        abatimentosCentavos,
        recebimentosCentavos,
        p.vencimento,
        hoje,
      ),
    };
  });
}
export function resumoFinanceiro(
  db: Database.Database,
  id: number,
  efeitos: Partial<
    Pick<
      ResumoFinanceiro,
      | 'abatimentosDividaCentavos'
      | 'reembolsosPagosCentavos'
      | 'estornosReembolsoCentavos'
      | 'estornosRecebimentoCentavos'
    >
  > = {},
): ResumoFinanceiro {
  const aplicar = (valor: number, delta = 0) => {
    const n = BigInt(valor) + BigInt(delta);
    if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
      throw new ComercialError('INTEGRITY', 'Total financeiro fora do limite seguro.');
    return Number(n);
  };
  const d = one<{ total_centavos: number; tipo: string }>(
    db,
    'SELECT total_centavos,tipo FROM documentos WHERE id=?',
    id,
  );
  if (!d) throw new ComercialError('NOT_FOUND', 'Venda não encontrada.');
  if (d.tipo !== 'VENDA') reject('Documento não é venda.');
  const query = (natureza: string) =>
    total(
      db,
      'SELECT valor_centavos AS valor FROM movimentos_financeiros WHERE documento_id=? AND natureza=?',
      id,
      natureza,
    );
  const reversed = (natureza: string) =>
    total(
      db,
      'SELECT e.valor_centavos AS valor FROM movimentos_financeiros e JOIN movimentos_financeiros m ON m.id=e.estorna_movimento_id WHERE m.documento_id=? AND m.natureza=?',
      id,
      natureza,
    );
  const abatimentosDividaCentavos = aplicar(
    total(
      db,
      "SELECT CASE a.natureza WHEN 'ABATIMENTO' THEN a.valor_centavos ELSE -a.valor_centavos END AS valor FROM abatimentos_parcela a JOIN parcelas_receber p ON p.id=a.parcela_id WHERE p.venda_id=?",
      id,
    ),
    efeitos.abatimentosDividaCentavos,
  );
  const recebimentosEfetivosCentavos = query('RECEBIMENTO_CLIENTE'),
    estornosRecebimentoCentavos = aplicar(
      reversed('RECEBIMENTO_CLIENTE'),
      efeitos.estornosRecebimentoCentavos,
    );
  const reembolsosPagosCentavos = aplicar(
      query('REEMBOLSO_CLIENTE'),
      efeitos.reembolsosPagosCentavos,
    ),
    estornosReembolsoCentavos = aplicar(
      reversed('REEMBOLSO_CLIENTE'),
      efeitos.estornosReembolsoCentavos,
    );
  const valorComercialLiquidoCentavos = dinheiro(
    BigInt(d.total_centavos) - BigInt(abatimentosDividaCentavos),
  );
  const caixa =
    BigInt(recebimentosEfetivosCentavos) -
    BigInt(estornosRecebimentoCentavos) -
    BigInt(reembolsosPagosCentavos) +
    BigInt(estornosReembolsoCentavos);
  return {
    vendaId: id,
    valorOriginalCentavos: d.total_centavos,
    devolucoesCancelamentosCentavos: abatimentosDividaCentavos,
    valorComercialLiquidoCentavos,
    recebimentosEfetivosCentavos,
    estornosRecebimentoCentavos,
    abatimentosDividaCentavos,
    reembolsosPagosCentavos,
    estornosReembolsoCentavos,
    saldoReceberCentavos: dinheiro(
      caixa < BigInt(valorComercialLiquidoCentavos)
        ? BigInt(valorComercialLiquidoCentavos) - caixa
        : 0n,
    ),
    reembolsosPendentesCentavos: dinheiro(
      caixa > BigInt(valorComercialLiquidoCentavos)
        ? caixa - BigInt(valorComercialLiquidoCentavos)
        : 0n,
    ),
  };
}
export function validarFormaAtiva(db: Database.Database, id: number) {
  const form = one<{ nome: string; ativo: number }>(
    db,
    'SELECT nome,ativo FROM formas_pagamento WHERE id=?',
    id,
  );
  if (!form?.ativo)
    throw new ComercialError('INACTIVE_REFERENCE', 'Forma de pagamento inativa ou inexistente.');
  return form;
}
export function inserirDinheiro(
  db: Database.Database,
  documentoId: number,
  natureza: string,
  sentido: string,
  p: PagamentoFinanceiro,
  data: string,
  op: string,
  now: string,
): number {
  const form = validarFormaAtiva(db, p.formaPagamentoId);
  return Number(
    db
      .prepare(
        'INSERT INTO movimentos_financeiros(documento_id,natureza,sentido,valor_centavos,forma_pagamento_id,forma_pagamento_historica,data_efetiva,registrado_em,operacao_id) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        documentoId,
        natureza,
        sentido,
        p.valorCentavos,
        p.formaPagamentoId,
        form.nome,
        data,
        now,
        op,
      ).lastInsertRowid,
  );
}
/** Prepara a alocação usando as mesmas regras da gravação, sem escrever no banco. */
export function normalizarRecebimento(
  raw: unknown,
  now: Date,
): import('../../shared/financeiro').DadosRecebimento {
  const v = record(raw, ['vendaId', 'dataEfetiva', 'pagamentos', 'alocacoes']);
  return {
    vendaId: identifier(v['vendaId']),
    dataEfetiva: effectiveDate(v['dataEfetiva'], now),
    pagamentos: pagamentos(v['pagamentos']),
    alocacoes:
      v['alocacoes'] === undefined
        ? undefined
        : lista(v['alocacoes']).map((raw) => {
            const a = record(raw, ['parcelaId', 'valorCentavos']);
            return {
              parcelaId: identifier(a['parcelaId']),
              valorCentavos: integer(a['valorCentavos'], 'valor', 1, 9_000_000_000_000),
            };
          }),
  };
}
export function prepararRecebimento(
  db: Database.Database,
  data: import('../../shared/financeiro').DadosRecebimento,
) {
  const d = one<{ estado: string; tipo: string; data_comercial: string }>(
    db,
    'SELECT * FROM documentos WHERE id=?',
    data.vendaId,
  );
  if (!d || d.tipo !== 'VENDA' || d.estado !== 'CONFIRMADO')
    throw new ComercialError('INVALID_STATE', 'Venda não está confirmada.');
  if (data.dataEfetiva < d.data_comercial) reject('Recebimento anterior à venda.');
  const ps = parcelasFinanceiras(db, data.vendaId, data.dataEfetiva),
    amount = somar(data.pagamentos.map((p) => p.valorCentavos));
  if (!amount || amount > somar(ps.map((p) => p.saldoCentavos)))
    reject('Recebimento excedente ou vazio.');
  let left = amount;
  const targets =
    data.alocacoes?.map((a) => ({ ...a })) ??
    ps.flatMap((p) => {
      const value = Math.min(left, p.saldoCentavos);
      left -= value;
      return value ? [{ parcelaId: p.id, valorCentavos: value }] : [];
    });
  if (
    somar(targets.map((a) => a.valorCentavos)) !== amount ||
    new Set(targets.map((a) => a.parcelaId)).size !== targets.length
  )
    reject('Alocações inválidas.');
  for (const a of targets)
    if (!ps.some((p) => p.id === a.parcelaId && a.valorCentavos <= p.saldoCentavos))
      reject('Parcela inválida ou excedente.');
  targets.sort(
    (a, b) => ps.findIndex((p) => p.id === a.parcelaId) - ps.findIndex((p) => p.id === b.parcelaId),
  );
  return { parcelas: ps, totalCentavos: amount, alocacoes: targets };
}

export function normalizarPagamentoReembolso(raw: unknown, now: Date) {
  const v = record(raw, ['reembolsoId', 'dataEfetiva', 'pagamentos']);
  return {
    reembolsoId: identifier(v['reembolsoId']),
    dataEfetiva: effectiveDate(v['dataEfetiva'], now),
    pagamentos: pagamentos(v['pagamentos']),
  };
}
export function prepararPagamentoReembolso(
  db: Database.Database,
  data: ReturnType<typeof normalizarPagamentoReembolso>,
) {
  const r = one<{ venda: number; data: string }>(
    db,
    "SELECT d.documento_origem_id venda,d.data_comercial data FROM reembolsos_cliente r JOIN documentos d ON d.id=r.documento_correcao_id WHERE r.id=? AND d.estado='CONFIRMADO'",
    data.reembolsoId,
  );
  if (!r) throw new ComercialError('INVALID_STATE', 'Obrigação indisponível.');
  const amount = somar(data.pagamentos.map((p) => p.valorCentavos));
  if (!amount || amount > saldoReembolso(db, data.reembolsoId) || data.dataEfetiva < r.data)
    reject('Pagamento excedente ou data inválida.');
  const origins = many<{ id: number; valor_centavos: number }>(
    db,
    'SELECT * FROM origens_reembolso WHERE reembolso_id=? ORDER BY id',
    data.reembolsoId,
  ).map((o) => ({
    ...o,
    remaining:
      o.valor_centavos -
      total(
        db,
        "SELECT CASE natureza WHEN 'PAGAMENTO' THEN valor_centavos ELSE -valor_centavos END valor FROM alocacoes_reembolso WHERE origem_reembolso_id=?",
        o.id,
      ),
  }));

  for (const p of data.pagamentos) validarFormaAtiva(db, p.formaPagamentoId);
  const pending = origins.map((o) => ({ ...o }));
  const plano = data.pagamentos.map((pagamento) => {
    let left = pagamento.valorCentavos;
    const alocacoes = pending.flatMap((o) => {
      const valorCentavos = Math.min(left, o.remaining);
      left -= valorCentavos;
      o.remaining -= valorCentavos;
      return valorCentavos ? [{ origemId: o.id, valorCentavos }] : [];
    });
    if (left) throw new ComercialError('INTEGRITY', 'Origens insuficientes.');
    return { pagamento, alocacoes };
  });
  return { r, amount, origins, plano };
}
export function normalizarEstornoFinanceiro(raw: unknown, now: Date) {
  const v = record(raw, ['movimentoId', 'dataEfetiva']);
  return {
    movimentoId: identifier(v['movimentoId']),
    dataEfetiva: effectiveDate(v['dataEfetiva'], now),
  };
}
export function prepararEstornoFinanceiro(
  db: Database.Database,
  data: ReturnType<typeof normalizarEstornoFinanceiro>,
  natureza: string,
) {
  const m = one<MovimentoFinanceiro>(
    db,
    'SELECT * FROM movimentos_financeiros WHERE id=?',
    data.movimentoId,
  );
  if (
    !m ||
    m.natureza !== natureza ||
    one(db, 'SELECT id FROM movimentos_financeiros WHERE estorna_movimento_id=?', m.id)
  )
    throw new ComercialError('INVALID_STATE', 'Movimento indisponível para estorno.');
  if (data.dataEfetiva < m.data_efetiva) reject('Estorno anterior ao movimento.');
  if (
    natureza === 'RECEBIMENTO_CLIENTE' &&
    one(
      db,
      `SELECT 1 FROM alocacoes_recebimento a JOIN parcelas_receber p ON p.id=a.parcela_id WHERE a.movimento_financeiro_id=? AND (EXISTS(SELECT 1 FROM origens_reembolso o JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id WHERE o.alocacao_recebimento_id=a.id AND d.estado='CONFIRMADO') OR EXISTS(SELECT 1 FROM abatimentos_parcela b JOIN documentos d ON d.id=b.documento_correcao_id WHERE b.parcela_id=p.id AND b.natureza='ABATIMENTO' AND d.estado='CONFIRMADO')) LIMIT 1`,
      m.id,
    )
  )
    throw new ComercialError(
      'INVALID_STATE',
      'Recebimento sustenta correção; desfaça dependências primeiro.',
    );

  return m;
}
export function createFinancialService(
  db: Database.Database,
  appVersion: string,
  clock: () => Date = () => new Date(),
) {
  const write = <T, R>(
    kind: string,
    input: unknown,
    normalize: (raw: unknown, now: Date) => T,
    action: (data: T, op: string, reason: string, now: string) => R,
  ) => comandoFinanceiro(db, appVersion, clock, `FINANCEIRO_${kind}`, input, normalize, action);
  return {
    consultarVenda: (input: unknown) =>
      db.transaction(() => resumoFinanceiro(db, identifier(input)))(),
    listarParcelas: (input: unknown) =>
      db.transaction(() => {
        const id = identifier(input);
        resumoFinanceiro(db, id);
        return parcelasFinanceiras(db, id, localDay(clock()));
      })(),
    listarMovimentos: (input: unknown) => {
      const v = record(input, ['documentoId', 'aposId', 'limite']);
      const id = identifier(v['documentoId']),
        after =
          v['aposId'] === undefined
            ? 0
            : integer(v['aposId'], 'aposId', 0, Number.MAX_SAFE_INTEGER),
        limit = v['limite'] === undefined ? 50 : integer(v['limite'], 'limite', 1, 200);
      return many<MovimentoFinanceiro>(
        db,
        'SELECT * FROM movimentos_financeiros WHERE documento_id=? AND id>? ORDER BY id LIMIT ?',
        id,
        after,
        limit,
      );
    },
    listarReembolsos: (input: unknown) =>
      db.transaction(() =>
        many<{ id: number; valor_centavos: number }>(
          db,
          "SELECT r.* FROM reembolsos_cliente r JOIN documentos d ON d.id=r.documento_correcao_id WHERE d.documento_origem_id=? AND d.estado='CONFIRMADO' ORDER BY r.id",
          identifier(input),
        ).map((r) => ({ ...r, saldoCentavos: saldoReembolso(db, r.id) })),
      )(),
    registrarRecebimento: (input: unknown) =>
      write('RECEBER', input, normalizarRecebimento, (data, op, _reason, now) => {
        const { alocacoes: targets } = prepararRecebimento(db, data);
        const pending = targets.map((a) => ({ ...a })),
          movimentos: number[] = [];
        for (const p of data.pagamentos) {
          const m = inserirDinheiro(
            db,
            data.vendaId,
            'RECEBIMENTO_CLIENTE',
            'ENTRADA',
            p,
            data.dataEfetiva,
            op,
            now,
          );
          movimentos.push(m);
          let remaining = p.valorCentavos;
          for (const a of pending) {
            const v = Math.min(remaining, a.valorCentavos);
            if (v)
              db.prepare(
                'INSERT INTO alocacoes_recebimento(movimento_financeiro_id,parcela_id,valor_centavos) VALUES (?,?,?)',
              ).run(m, a.parcelaId, v);
            remaining -= v;
            a.valorCentavos -= v;
          }
        }
        return { movimentos, financeiro: resumoFinanceiro(db, data.vendaId) };
      }),
    pagarReembolso: (input: unknown) =>
      write('REEMBOLSAR', input, normalizarPagamentoReembolso, (data, op, _reason, now) => {
        const { r, plano } = prepararPagamentoReembolso(db, data);
        const movimentos: number[] = [];
        for (const planned of plano) {
          const m = inserirDinheiro(
            db,
            r.venda,
            'REEMBOLSO_CLIENTE',
            'SAIDA',
            planned.pagamento,
            data.dataEfetiva,
            op,
            now,
          );
          movimentos.push(m);
          for (const a of planned.alocacoes)
            db.prepare(
              "INSERT INTO alocacoes_reembolso(origem_reembolso_id,movimento_financeiro_id,valor_centavos,natureza) VALUES (?,?,?,'PAGAMENTO')",
            ).run(a.origemId, m, a.valorCentavos);
        }
        return { movimentos, financeiro: resumoFinanceiro(db, r.venda) };
      }),
    estornarRecebimento: (input: unknown) => estornar(input, 'RECEBIMENTO_CLIENTE'),
    estornarReembolso: (input: unknown) => estornar(input, 'REEMBOLSO_CLIENTE'),
  };
  function estornar(input: unknown, natureza: string) {
    return write(
      `ESTORNAR_${natureza}`,
      input,
      normalizarEstornoFinanceiro,
      (data, op, _reason, now) => {
        const m = prepararEstornoFinanceiro(db, data, natureza);
        const id = estornarMovimento(db, m, data.dataEfetiva, op, now);
        return { movimentoId: id, financeiro: resumoFinanceiro(db, m.documento_id) };
      },
    );
  }
}
export interface MovimentoFinanceiro {
  id: number;
  documento_id: number;
  natureza: string;
  sentido: string;
  valor_centavos: number;
  forma_pagamento_id: number;
  forma_pagamento_historica: string;
  data_efetiva: string;
}
export function estornarMovimento(
  db: Database.Database,
  m: MovimentoFinanceiro,
  data: string,
  op: string,
  now: string,
): number {
  const id = Number(
    db
      .prepare(
        "INSERT INTO movimentos_financeiros(documento_id,natureza,sentido,valor_centavos,forma_pagamento_id,forma_pagamento_historica,data_efetiva,registrado_em,operacao_id,estorna_movimento_id) VALUES (?,'ESTORNO_FINANCEIRO',?,?,?,?,?,?,?,?)",
      )
      .run(
        m.documento_id,
        m.sentido === 'ENTRADA' ? 'SAIDA' : 'ENTRADA',
        m.valor_centavos,
        m.forma_pagamento_id,
        m.forma_pagamento_historica,
        data,
        now,
        op,
        m.id,
      ).lastInsertRowid,
  );
  for (const a of many<{ id: number; parcela_id: number; valor_centavos: number }>(
    db,
    'SELECT * FROM alocacoes_recebimento WHERE movimento_financeiro_id=?',
    m.id,
  ))
    db.prepare(
      "INSERT INTO alocacoes_recebimento(movimento_financeiro_id,parcela_id,valor_centavos,natureza,estorna_alocacao_id) VALUES (?,?,?,'ESTORNO',?)",
    ).run(id, a.parcela_id, a.valor_centavos, a.id);
  for (const a of many<{ id: number; origem_reembolso_id: number; valor_centavos: number }>(
    db,
    'SELECT * FROM alocacoes_reembolso WHERE movimento_financeiro_id=?',
    m.id,
  ))
    db.prepare(
      "INSERT INTO alocacoes_reembolso(origem_reembolso_id,movimento_financeiro_id,valor_centavos,natureza,estorna_alocacao_id) VALUES (?,?,?,'ESTORNO',?)",
    ).run(a.origem_reembolso_id, id, a.valor_centavos, a.id);
  return id;
}
export function saldoReembolsoApurado(original: number, pagoLiquido: number): number {
  return dinheiro(BigInt(original) - BigInt(pagoLiquido));
}
export function saldoReembolso(db: Database.Database, id: number): number {
  const r = one<{ valor_centavos: number }>(
    db,
    'SELECT valor_centavos FROM reembolsos_cliente WHERE id=?',
    id,
  );
  if (!r) throw new ComercialError('NOT_FOUND', 'Reembolso inexistente.');
  return saldoReembolsoApurado(
    r.valor_centavos,
    total(
      db,
      "SELECT CASE a.natureza WHEN 'PAGAMENTO' THEN a.valor_centavos ELSE -a.valor_centavos END valor FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id WHERE o.reembolso_id=?",
      id,
    ),
  );
}
export function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
