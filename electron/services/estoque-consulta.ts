import type Database from 'better-sqlite3';
import type { PaginaEstoque, ProdutoEstoque, PaginaMovimentacoes } from '../../shared/estoque-ipc';
import { active, identifier, integer, nameKey, optionalText, record } from './catalog-validation';
import { createStockService } from './estoque';

const fields = `p.id AS produtoId,p.nome,p.sku,p.ativo,p.estoque_minimo AS estoqueMinimo,
  s.quantidade,s.valor_total_centavos AS valorTotalCentavos,s.versao`;
type Stored = Omit<ProdutoEstoque, 'ativo' | 'baixo' | 'custoMedioDecimal'> & { ativo: number };
function dto(row: Stored): ProdutoEstoque {
  const q = BigInt(row.quantidade),
    v = BigInt(row.valorTotalCentavos);
  const cents = q === 0n ? null : (2n * v + q) / (2n * q);
  const digits = cents?.toString().padStart(3, '0');
  return {
    ...row,
    ativo: row.ativo === 1,
    baixo: row.quantidade < row.estoqueMinimo,
    custoMedioDecimal: digits ? digits.slice(0, -2) + ',' + digits.slice(-2) : null,
  };
}

// Read side only. Existing stock writers and official costing remain unchanged.
export function createStockQueryService(db: Database.Database, version: string) {
  db.function('mnr_nome_chave', { deterministic: true }, nameKey);
  const stock = createStockService(db, version);
  function obter(input: unknown): ProdutoEstoque {
    const id = identifier(input);
    stock.consultarSaldo(id);
    return dto(
      db
        .prepare(
          `SELECT ${fields} FROM produtos p JOIN saldos_estoque s ON s.produto_id=p.id WHERE p.id=?`,
        )
        .get(id) as Stored,
    );
  }
  return {
    obter: (input: unknown) => db.transaction(() => obter(input))(),
    listar: (input: unknown): PaginaEstoque => {
      const f = record(input, ['busca', 'ativo', 'somenteBaixo', 'limite', 'deslocamento']);
      const busca = nameKey(optionalText(f['busca'], 'busca', 200) ?? '');
      const ativo = active(f['ativo']);
      const baixo = active(f['somenteBaixo']) ?? false;
      const limite = f['limite'] === undefined ? 25 : integer(f['limite'], 'limite', 1, 200);
      const offset =
        f['deslocamento'] === undefined
          ? 0
          : integer(f['deslocamento'], 'deslocamento', 0, 1_000_000_000);
      const from = `FROM produtos p JOIN saldos_estoque s ON s.produto_id=p.id
        WHERE instr(mnr_nome_chave(p.nome || char(32) || p.sku),?)>0
        AND (? IS NULL OR p.ativo=?) AND (?=0 OR s.quantidade<p.estoque_minimo)`;
      const args = [
        busca,
        ativo === undefined ? null : Number(ativo),
        ativo === undefined ? null : Number(ativo),
        Number(baixo),
      ];
      return db.transaction(() => {
        const rows = db
          .prepare(`SELECT ${fields} ${from} ORDER BY p.nome,p.id LIMIT ? OFFSET ?`)
          .all(...args, limite + 1, offset) as Stored[];
        let total = 0n;
        // Avoid SQLite SUM overflow and Number precision loss across many products.
        for (const row of db
          .prepare(`SELECT s.valor_total_centavos AS valor ${from}`)
          .iterate(...args) as Iterable<{ valor: number }>)
          total += BigInt(row.valor);
        return {
          itens: rows.slice(0, limite).map(dto),
          temMais: rows.length > limite,
          valorTotalFiltradoCentavos: total.toString(),
        };
      })();
    },
    listarMovimentacoes: (input: unknown): PaginaMovimentacoes => {
      const f = record(input, ['produtoId', 'aposId', 'limite']);
      const id = identifier(f['produtoId']);
      const after =
        f['aposId'] === undefined ? 0 : integer(f['aposId'], 'aposId', 0, Number.MAX_SAFE_INTEGER);
      const limit = f['limite'] === undefined ? 25 : integer(f['limite'], 'limite', 1, 200);
      return db.transaction(() => {
        const rows = stock.listarMovimentacoes(id, { aposId: after, limite: limit });
        const itens = rows.map((row) => {
          const { tipo } = db
            .prepare('SELECT tipo FROM operacoes WHERE id=?')
            .get(row.operacaoId) as { tipo: string };
          return {
            ajusteManual:
              ['AJUSTE_ENTRADA', 'AJUSTE_SAIDA', 'PERDA'].includes(row.natureza) &&
              ['ESTOQUE_CONTAGEM', `ESTOQUE_${row.natureza}`].includes(tipo),
            ajusteOrigemId: tipo === 'CORRECAO_ESTORNAR_AJUSTE' ? row.movimentacaoOrigemId : null,
            ...row,
            contagem: tipo === 'ESTOQUE_CONTAGEM',
          };
        });
        const last = rows.at(-1)?.id ?? after;
        const temMais = !!db
          .prepare('SELECT 1 FROM movimentacoes_estoque WHERE produto_id=? AND id>? LIMIT 1')
          .get(id, last);
        return { itens, temMais, proximoId: last };
      })();
    },
  };
}
