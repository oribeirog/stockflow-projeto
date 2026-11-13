import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonical, identifier, record, text } from './catalog-validation';
import { ComercialError } from './comercial';
import { createCorrectionService } from './correcoes';
import { createStockQueryService } from './estoque-consulta';
import { localDay } from './financeiro';
import type {
  DetalheAjuste,
  MovimentoAjuste,
  RevisaoEstornoAjuste,
} from '../../shared/estornos-estoque-ipc';
const fields = `m.id,m.natureza,m.quantidade_delta AS quantidadeDelta,m.valor_delta_centavos AS valorDeltaCentavos,m.quantidade_apos AS quantidadeApos,m.valor_apos_centavos AS valorAposCentavos,m.data_efetiva AS dataEfetiva,m.registrado_em AS registradoEm,m.motivo,m.movimentacao_origem_id AS origemId,CASE WHEN o.tipo='ESTOQUE_CONTAGEM' THEN 1 ELSE 0 END AS contagem`;
export function createStockReversalService(
  db: Database.Database,
  version: string,
  clock: () => Date = () => new Date(),
) {
  const core = createCorrectionService(db, version, clock),
    stock = createStockQueryService(db, version);
  function bind(input: unknown, dated = false) {
    const v = record(
      input,
      dated ? ['produtoId', 'movimentoId', 'dataEfetiva'] : ['produtoId', 'movimentoId'],
    );
    const produtoId = identifier(v['produtoId']),
      movimentoId = identifier(v['movimentoId']);
    const source = db
      .prepare(
        'SELECT m.produto_id,m.natureza,o.tipo FROM movimentacoes_estoque m JOIN operacoes o ON o.id=m.operacao_id WHERE m.id=?',
      )
      .get(movimentoId) as { produto_id: number; natureza: string; tipo: string } | undefined;
    if (!source || source.produto_id !== produtoId)
      throw new ComercialError('NOT_FOUND', 'Ajuste não encontrado.');
    if (
      !['AJUSTE_ENTRADA', 'AJUSTE_SAIDA', 'PERDA'].includes(source.natureza) ||
      ![`ESTOQUE_${source.natureza}`, 'ESTOQUE_CONTAGEM'].includes(source.tipo)
    )
      throw new ComercialError('INVALID_STATE', 'Movimento não é ajuste manual.');
    return { produtoId, movimentoId, ...(dated ? { dataEfetiva: v['dataEfetiva'] } : {}) };
  }
  function movimento(id: number) {
    const m = db
      .prepare(
        `SELECT ${fields} FROM movimentacoes_estoque m JOIN operacoes o ON o.id=m.operacao_id WHERE m.id=?`,
      )
      .get(id) as MovimentoAjuste & { contagem: unknown };
    return { ...m, contagem: !!m.contagem };
  }
  function context(input: unknown): DetalheAjuste {
    const r = bind(input),
      produto = stock.obter(r.produtoId),
      original = movimento(r.movimentoId);
    const reverse = db
      .prepare(
        "SELECT id FROM movimentacoes_estoque WHERE movimentacao_origem_id=? AND natureza IN ('REVERSAO_ENTRADA','REVERSAO_SAIDA')",
      )
      .get(original.id) as { id: number } | undefined;
    let impedimento: string | null = null;
    try {
      core.prepararEstornoAjuste({ movimentoId: original.id, dataEfetiva: localDay(clock()) });
    } catch (e) {
      if (!(e instanceof ComercialError)) throw e;
      const messages: Record<string, string> = {
        'Ajuste já estornado.':
          'Este ajuste já foi estornado. Consulte o movimento inverso vinculado.',
        'Há movimentação posterior do mesmo produto.':
          'Há movimentação posterior do mesmo produto. A regra da 3D e a proteção SQLite impedem a reversão histórica. Não serão desfeitas operações em cascata.',
        'Estoque insuficiente.': 'Estoque insuficiente para retirar a quantidade original.',
        'Reversão incompatível com o saldo monetário.':
          'Quantidade ou valor atual incompatível com a reversão histórica.',
      };
      if (!messages[e.message]) throw e;
      impedimento = messages[e.message];
    }
    const ids = db
      .prepare(
        'SELECT id FROM movimentacoes_estoque WHERE produto_id=? AND id>? ORDER BY id LIMIT 21',
      )
      .all(r.produtoId, original.id) as { id: number }[];
    return {
      produto,
      original,
      estorno: reverse ? movimento(reverse.id) : null,
      elegivel: impedimento === null,
      impedimento,
      posteriores: ids.slice(0, 20).map((v) => movimento(v.id)),
      temMaisPosteriores: ids.length > 20,
    };
  }
  function normalize(input: unknown) {
    const r = bind(input, true),
      data = core.normalizarEstornoAjuste({
        movimentoId: r.movimentoId,
        dataEfetiva: r.dataEfetiva,
      });
    return { produtoId: r.produtoId, ...data };
  }
  function fingerprint(dados: ReturnType<typeof normalize>, motivo: string) {
    return createHash('sha256')
      .update(
        canonical({
          dados,
          motivo,
          produto: db.prepare('SELECT * FROM produtos WHERE id=?').get(dados.produtoId),
          saldo: db.prepare('SELECT * FROM saldos_estoque WHERE produto_id=?').get(dados.produtoId),
          movimentos: db
            .prepare('SELECT * FROM movimentacoes_estoque WHERE produto_id=? ORDER BY id')
            .all(dados.produtoId),
          operacao: db
            .prepare(
              'SELECT o.* FROM operacoes o JOIN movimentacoes_estoque m ON m.operacao_id=o.id WHERE m.id=?',
            )
            .get(dados.movimentoId),
        }),
      )
      .digest('hex');
  }
  function review(input: unknown): RevisaoEstornoAjuste {
    const e = record(input, ['dados', 'motivo']),
      dados = normalize(e['dados']),
      motivo = text(e['motivo'], 'motivo', 4000),
      p = core.prepararEstornoAjuste(dados);
    return {
      dados,
      motivo,
      revisao: fingerprint(dados, motivo),
      contexto: context({ produtoId: dados.produtoId, movimentoId: dados.movimentoId }),
      quantidadeDelta: p.quantidadeDelta,
      valorDeltaCentavos: p.valorDeltaCentavos,
      quantidadeAntes: p.quantidadeAntes,
      valorAntesCentavos: p.valorAntesCentavos,
      quantidadeApos: p.quantidadeApos,
      valorAposCentavos: p.valorAposCentavos,
      versao: p.versao,
    };
  }
  return {
    obterAjuste: (input: unknown) => db.transaction(() => context(input))(),
    revisarEstorno: (input: unknown) => db.transaction(() => review(input))(),
    estornar: (input: unknown) => {
      const e = record(input, ['operacaoId', 'dados', 'motivo', 'revisao']),
        dados = normalize(e['dados']),
        motivo = text(e['motivo'], 'motivo', 4000),
        operacaoId = text(e['operacaoId'], 'operacaoId', 100),
        revisao = text(e['revisao'], 'revisao', 64);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          operacaoId,
        ) ||
        !/^[0-9a-f]{64}$/.test(revisao)
      )
        throw new ComercialError('VALIDATION', 'Intenção ou revisão inválida.');
      return db
        .transaction(() => {
          if (
            !db.prepare('SELECT id FROM operacoes WHERE id=?').get(operacaoId) &&
            fingerprint(dados, motivo) !== revisao
          )
            throw new ComercialError('VERSION_CONFLICT', 'O ajuste ou estoque mudou.');
          return core.estornarAjuste({
            operacaoId,
            motivo,
            dados: { movimentoId: dados.movimentoId, dataEfetiva: dados.dataEfetiva },
          });
        })
        .immediate();
    },
  };
}
