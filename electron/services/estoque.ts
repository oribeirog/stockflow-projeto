import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type {
  NaturezaEstoque,
  SaldoEstoque,
  ResultadoEstoque,
  MovimentacaoEstoque,
} from '../../shared/estoque';
import { custoSaida, stockNumber, MAX_STOCK_MONEY, MAX_STOCK_QUANTITY } from '../domain/custeio';
import { canonical } from './catalog-validation';
import {
  EstoqueError,
  stockValidation,
  record,
  text,
  integer,
  identifier,
  effectiveDate,
} from './estoque-validation';
import { reconciliarEstoque } from './estoque-reconciliation';

const saldoFields =
  'produto_id AS produtoId, quantidade, valor_total_centavos AS valorTotalCentavos, versao';
const movementFields = `id, produto_id AS produtoId, natureza, quantidade_delta AS quantidadeDelta,
  valor_delta_centavos AS valorDeltaCentavos, quantidade_apos AS quantidadeApos,
  valor_apos_centavos AS valorAposCentavos, versao_apos AS versaoApos, motivo,
  data_efetiva AS dataEfetiva, registrado_em AS registradoEm, operacao_id AS operacaoId,
  movimentacao_origem_id AS movimentacaoOrigemId`;

interface AplicacaoMovimento {
  produtoId: number;
  natureza: NaturezaEstoque;
  quantidade: number;
  custoTotalCentavos?: number;
  movimentacaoOrigemId: number | null;
  operacaoId: string;
  motivo: string;
  dataEfetiva: string;
  registradoEm: string;
}

// Transaction composition point for 3C. The caller owns operation, audit and commit.
// SQLite triggers independently enforce cost, snapshots and the provisional operation FK.
export function aplicarMovimentoNaTransacao(
  db: Database.Database,
  data: AplicacaoMovimento,
): ResultadoEstoque {
  if (!db.inTransaction) throw new EstoqueError('INTEGRITY', 'Movimento exige transação ativa.');
  const before = db
    .prepare(`SELECT ${saldoFields} FROM saldos_estoque WHERE produto_id = ?`)
    .get(data.produtoId) as SaldoEstoque | undefined;
  if (!before) throw new EstoqueError('NOT_FOUND', 'Produto ou saldo não encontrado.');
  const incoming = ['AJUSTE_ENTRADA', 'COMPRA', 'DEV_VENDA', 'REVERSAO_ENTRADA'].includes(
    data.natureza,
  );
  const quantity = BigInt(data.quantidade);
  if (quantity <= 0n || quantity > MAX_STOCK_QUANTITY)
    throw new EstoqueError('VALIDATION', 'Quantidade inválida.');
  if (!incoming && quantity > BigInt(before.quantidade))
    throw new EstoqueError('INSUFFICIENT_STOCK', 'Estoque insuficiente.');
  const cost =
    incoming || ['REVERSAO_SAIDA', 'PERDA_DEVOLUCAO'].includes(data.natureza)
      ? BigInt(data.custoTotalCentavos ?? -1)
      : custoSaida(BigInt(before.valorTotalCentavos), BigInt(before.quantidade), quantity);
  if (cost < 0n || cost > MAX_STOCK_MONEY) throw new EstoqueError('VALIDATION', 'Custo inválido.');
  const deltaQ = incoming ? quantity : -quantity;
  const deltaV = incoming ? cost : -cost;
  const after: SaldoEstoque = {
    produtoId: before.produtoId,
    quantidade: stockNumber(BigInt(before.quantidade) + deltaQ, MAX_STOCK_QUANTITY),
    valorTotalCentavos: stockNumber(BigInt(before.valorTotalCentavos) + deltaV, MAX_STOCK_MONEY),
    versao: stockNumber(BigInt(before.versao) + 1n, BigInt(Number.MAX_SAFE_INTEGER)),
  };
  const inserted = db
    .prepare(
      `INSERT INTO movimentacoes_estoque
    (produto_id,natureza,quantidade_delta,valor_delta_centavos,quantidade_apos,valor_apos_centavos,versao_apos,
      motivo,data_efetiva,registrado_em,operacao_id,movimentacao_origem_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      data.produtoId,
      data.natureza,
      Number(deltaQ),
      Number(deltaV),
      after.quantidade,
      after.valorTotalCentavos,
      after.versao,
      data.motivo,
      data.dataEfetiva,
      data.registradoEm,
      data.operacaoId,
      data.movimentacaoOrigemId,
    );
  return {
    saldo: after,
    movimentacaoId: stockNumber(BigInt(inserted.lastInsertRowid), BigInt(Number.MAX_SAFE_INTEGER)),
  };
}

export function createStockService(
  db: Database.Database,
  appVersion: string,
  clock: () => Date = () => new Date(),
) {
  function consultarSaldo(input: unknown): SaldoEstoque {
    return stockValidation(() => {
      const id = identifier(input);
      const row = db
        .prepare(`SELECT ${saldoFields} FROM saldos_estoque WHERE produto_id = ?`)
        .get(id) as SaldoEstoque | undefined;
      if (!row) throw new EstoqueError('NOT_FOUND', 'Produto ou saldo não encontrado.');
      return row;
    });
  }
  function write(kind: NaturezaEstoque | 'CONTAGEM', command: unknown): ResultadoEstoque {
    return stockValidation(() => {
      const envelope = record(command, ['operacaoId', 'motivo', 'dataEfetiva', 'dados']);
      const operacaoId = text(envelope['operacaoId'], 'operacaoId', 100);
      if (!/^[A-Za-z0-9_-]+$/.test(operacaoId))
        throw new EstoqueError('VALIDATION', 'Chave inválida.');
      const motivo = text(envelope['motivo'], 'motivo', 4000);
      const now = clock();
      const dataEfetiva = effectiveDate(envelope['dataEfetiva'], now);
      const counting = kind === 'CONTAGEM';
      const incoming = kind === 'AJUSTE_ENTRADA';
      const value = record(
        envelope['dados'],
        counting
          ? ['produtoId', 'quantidadeContada', 'versaoEsperada', 'custoTotalCentavos']
          : incoming
            ? ['produtoId', 'quantidade', 'custoTotalCentavos', 'movimentacaoOrigemId']
            : ['produtoId', 'quantidade', 'movimentacaoOrigemId'],
      );
      const data = {
        produtoId: identifier(value['produtoId']),
        quantidade: counting
          ? undefined
          : integer(value['quantidade'], 'quantidade', 1, Number(MAX_STOCK_QUANTITY)),
        quantidadeContada: counting
          ? integer(value['quantidadeContada'], 'quantidadeContada', 0, Number(MAX_STOCK_QUANTITY))
          : undefined,
        versaoEsperada: counting
          ? integer(value['versaoEsperada'], 'versaoEsperada', 0, Number.MAX_SAFE_INTEGER)
          : undefined,
        custoTotalCentavos:
          value['custoTotalCentavos'] === undefined
            ? undefined
            : integer(
                value['custoTotalCentavos'],
                'custoTotalCentavos',
                0,
                Number(MAX_STOCK_MONEY),
              ),
        movimentacaoOrigemId:
          value['movimentacaoOrigemId'] === undefined
            ? null
            : identifier(value['movimentacaoOrigemId']),
      };
      if (incoming && data.custoTotalCentavos === undefined)
        throw new EstoqueError('VALIDATION', 'Entrada exige custo total.');
      const type = `ESTOQUE_${kind}`;
      const hash = createHash('sha256')
        .update(canonical({ version: 1, kind: type, data, motivo, dataEfetiva }))
        .digest('hex');
      try {
        return db
          .transaction(() => {
            const previous = db
              .prepare('SELECT tipo, hash_entrada, resultado_json FROM operacoes WHERE id=?')
              .get(operacaoId) as
              | { tipo: string; hash_entrada: string; resultado_json: string }
              | undefined;
            if (previous) {
              if (previous.tipo !== type || previous.hash_entrada !== hash)
                throw new EstoqueError('IDEMPOTENCY_CONFLICT', 'Chave usada com outro conteúdo.');
              if (previous.resultado_json === 'null')
                throw new EstoqueError('INTEGRITY', 'Operação incompleta.');
              return JSON.parse(previous.resultado_json) as ResultadoEstoque;
            }
            db.prepare('INSERT INTO operacoes VALUES (?,?,?,?,?)').run(
              operacaoId,
              type,
              hash,
              'null',
              now.toISOString(),
            );
            const before = consultarSaldo(data.produtoId);
            let nature: NaturezaEstoque = counting ? 'AJUSTE_ENTRADA' : (kind as NaturezaEstoque);
            let quantity = data.quantidade ?? 0;
            if (counting) {
              if (before.versao !== data.versaoEsperada)
                throw new EstoqueError('VERSION_CONFLICT', 'Saldo mudou; consulte novamente.');
              const difference = BigInt(data.quantidadeContada!) - BigInt(before.quantidade);
              nature = difference >= 0n ? 'AJUSTE_ENTRADA' : 'AJUSTE_SAIDA';
              quantity = Number(difference < 0n ? -difference : difference);
              if (difference > 0n && data.custoTotalCentavos === undefined)
                throw new EstoqueError('VALIDATION', 'Sobra exige custo total.');
              if (difference <= 0n && data.custoTotalCentavos !== undefined)
                throw new EstoqueError('VALIDATION', 'Custo informado sem entrada.');
            }
            const result =
              quantity === 0
                ? { saldo: before, movimentacaoId: null }
                : aplicarMovimentoNaTransacao(db, {
                    produtoId: data.produtoId,
                    natureza: nature,
                    quantidade: quantity,
                    custoTotalCentavos: data.custoTotalCentavos,
                    movimentacaoOrigemId: data.movimentacaoOrigemId,
                    operacaoId,
                    motivo,
                    dataEfetiva,
                    registradoEm: now.toISOString(),
                  });
            db.prepare(
              `INSERT INTO eventos_auditoria
            (operacao_id,produto_id,evento,motivo,antes_json,depois_json,registrado_em,versao_aplicativo)
            VALUES (?,?,?,?,?,?,?,?)`,
            ).run(
              operacaoId,
              data.produtoId,
              type,
              motivo,
              JSON.stringify(before),
              JSON.stringify({
                ...result,
                ...(counting
                  ? {
                      quantidadeContada: data.quantidadeContada,
                      versaoEsperada: data.versaoEsperada,
                    }
                  : {}),
              }),
              now.toISOString(),
              appVersion,
            );
            db.prepare('UPDATE operacoes SET resultado_json=? WHERE id=?').run(
              JSON.stringify(result),
              operacaoId,
            );
            return result;
          })
          .immediate();
      } catch (error) {
        if (error instanceof RangeError) throw new EstoqueError('VALIDATION', error.message);
        const code = (error as { code?: string }).code;
        if (code?.startsWith('SQLITE_BUSY') || code?.startsWith('SQLITE_LOCKED'))
          throw new EstoqueError('BUSY', 'Banco ocupado; tente novamente com a mesma chave.');
        if (code?.startsWith('SQLITE_CONSTRAINT'))
          throw new EstoqueError('INTEGRITY', 'Restrição de integridade do estoque.');
        throw error;
      }
    });
  }
  return {
    consultarSaldo,
    registrarEntrada: (command: unknown) => write('AJUSTE_ENTRADA', command),
    registrarSaida: (command: unknown) => write('AJUSTE_SAIDA', command),
    registrarPerda: (command: unknown) => write('PERDA', command),
    registrarContagem: (command: unknown) => write('CONTAGEM', command),
    listarMovimentacoes: (produtoId: number, input: unknown = {}): MovimentacaoEstoque[] =>
      stockValidation(() => {
        consultarSaldo(produtoId);
        const filters = record(input, ['aposId', 'limite']);
        const after =
          filters['aposId'] === undefined
            ? 0
            : integer(filters['aposId'], 'aposId', 0, Number.MAX_SAFE_INTEGER);
        const limit =
          filters['limite'] === undefined ? 50 : integer(filters['limite'], 'limite', 1, 200);
        return db
          .prepare(
            `SELECT ${movementFields} FROM movimentacoes_estoque WHERE produto_id=? AND id>? ORDER BY id LIMIT ?`,
          )
          .all(produtoId, after, limit) as MovimentacaoEstoque[];
      }),
    reconciliarEstoque: () => reconciliarEstoque(db),
  };
}
