import type Database from 'better-sqlite3';
import type { ReconciliacaoEstoque } from '../../shared/estoque';
import { MAX_STOCK_MONEY, MAX_STOCK_QUANTITY } from '../domain/custeio';

export function reconciliarEstoque(db: Database.Database): ReconciliacaoEstoque {
  return db.transaction(() => {
    const result: ReconciliacaoEstoque = {
      consistente: true,
      produtos: 0,
      movimentacoes: 0,
      divergencias: [],
    };
    const movements = db
      .prepare(
        `SELECT id, quantidade_delta q, valor_delta_centavos v,
      quantidade_apos qa, valor_apos_centavos va, versao_apos versao
      FROM movimentacoes_estoque WHERE produto_id = ? ORDER BY id`,
      )
      .safeIntegers();
    const products = db
      .prepare(
        `SELECT p.id, s.quantidade q, s.valor_total_centavos v, s.versao
      FROM produtos p LEFT JOIN saldos_estoque s ON s.produto_id = p.id ORDER BY p.id`,
      )
      .safeIntegers();
    for (const value of products.iterate()) {
      const product = value as {
        id: bigint;
        q: bigint | null;
        v: bigint | null;
        versao: bigint | null;
      };
      result.produtos++;
      let q = 0n,
        v = 0n,
        version = 0n;
      const compare = (
        field: string,
        expected: bigint | string,
        actual: bigint | null | string,
        id: bigint | null,
      ) => {
        if (String(expected) !== String(actual)) {
          result.consistente = false;
          result.divergencias.push({
            produtoId: Number(product.id),
            movimentacaoId: id === null ? null : Number(id),
            campo: field,
            esperado: String(expected),
            encontrado: String(actual),
          });
        }
      };
      for (const row of movements.iterate(product.id)) {
        const m = row as {
          id: bigint;
          q: bigint;
          v: bigint;
          qa: bigint;
          va: bigint;
          versao: bigint;
        };
        q += m.q;
        v += m.v;
        version++;
        result.movimentacoes++;
        compare('quantidadeApos', q, m.qa, m.id);
        compare('valorAposCentavos', v, m.va, m.id);
        compare('versaoApos', version, m.versao, m.id);
        if (
          q < 0n ||
          q > MAX_STOCK_QUANTITY ||
          v < 0n ||
          v > MAX_STOCK_MONEY ||
          (q === 0n && v !== 0n)
        )
          compare('dominioHistorico', 'saldo valido', `${q}/${v}`, m.id);
      }
      compare('quantidade', q, product.q, null);
      compare('valorTotalCentavos', v, product.v, null);
      compare('versao', version, product.versao, null);
    }
    return result;
  })();
}
