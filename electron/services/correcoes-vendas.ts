import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonical, record, text } from './catalog-validation';
import { ComercialError } from './comercial';
import { createCorrectionService } from './correcoes';
import { resumoFinanceiro } from './financeiro';
import type { RevisaoCorrecao } from '../../shared/correcoes-ipc';

export function createSaleCorrectionService(
  db: Database.Database,
  version: string,
  clock: () => Date = () => new Date(),
) {
  const service = createCorrectionService(db, version, clock);
  function normalize(raw: unknown, cancel: boolean) {
    record(raw, cancel ? ['documentoId', 'dataEfetiva'] : ['documentoId', 'dataEfetiva', 'itens']);
    return service.normalizarVenda(raw, cancel);
  }
  function fingerprint(data: ReturnType<typeof normalize>, motivo: string, cancel: boolean) {
    const id = data.documentoId;
    const read = (sql: string) => db.prepare(sql).all(id);
    return createHash('sha256')
      .update(
        canonical({
          data,
          motivo,
          cancel,
          documento: read('SELECT * FROM documentos WHERE id=?'),
          itens: read('SELECT * FROM itens_documento WHERE documento_id=? ORDER BY id'),
          correcoes: read('SELECT * FROM documentos WHERE documento_origem_id=? ORDER BY id'),
          parcelas: read('SELECT * FROM parcelas_receber WHERE venda_id=? ORDER BY id'),
          movimentos: read('SELECT * FROM movimentos_financeiros WHERE documento_id=? ORDER BY id'),
          alocacoes: read(
            'SELECT a.* FROM alocacoes_recebimento a JOIN parcelas_receber p ON p.id=a.parcela_id WHERE p.venda_id=? ORDER BY a.id',
          ),
          abatimentos: read(
            'SELECT a.* FROM abatimentos_parcela a JOIN parcelas_receber p ON p.id=a.parcela_id WHERE p.venda_id=? ORDER BY a.id',
          ),
          reembolsos: read(
            'SELECT r.* FROM reembolsos_cliente r JOIN documentos d ON d.id=r.documento_correcao_id WHERE d.documento_origem_id=? ORDER BY r.id',
          ),
          pagamentosReembolso: read(
            'SELECT a.* FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id WHERE d.documento_origem_id=? ORDER BY a.id',
          ),
          estoque: read(
            'SELECT s.* FROM saldos_estoque s WHERE produto_id IN (SELECT produto_id FROM itens_documento WHERE documento_id=?) ORDER BY produto_id',
          ),
          movimentosEstoque: read(
            'SELECT m.id FROM movimentacoes_estoque m WHERE produto_id IN (SELECT produto_id FROM itens_documento WHERE documento_id=?) ORDER BY id',
          ),
        }),
      )
      .digest('hex');
  }
  function review(input: unknown, cancel: boolean): RevisaoCorrecao {
    const e = record(input, ['motivo', 'dados']);
    const motivo = text(e['motivo'], 'motivo', 4000);
    const data = normalize(e['dados'], cancel);
    const p = service.prepararVenda(data, cancel);
    const resumoAnterior = resumoFinanceiro(db, data.documentoId);
    const parcelas = p.financeiro.ps.map((row) => {
      const abatimentoCentavos = p.financeiro.abat.get(row.id) ?? 0;
      return {
        parcelaId: row.id,
        abatimentoCentavos,
        saldoAnteriorCentavos: row.saldoCentavos,
        saldoPrevistoCentavos: Math.max(row.saldoCentavos - abatimentoCentavos, 0),
      };
    });
    return {
      dados: {
        documentoId: data.documentoId,
        dataEfetiva: data.dataEfetiva,
        ...(!cancel ? { itens: data.itens } : {}),
      },
      motivo,
      cancelamento: cancel,
      revisao: fingerprint(data, motivo, cancel),
      venda: {
        id: p.d.id,
        numero: p.d.numero,
        cliente: p.d.contraparte_nome,
        dataComercial: p.d.data_comercial,
      },
      itens: p.rows,
      estoque: p.estoque,
      parcelas,
      valorCentavos: p.valorCentavos,
      resumoAnterior,
      comercialPrevistoCentavos: resumoAnterior.valorComercialLiquidoCentavos - p.valorCentavos,
      saldoPrevistoCentavos: Math.max(resumoAnterior.saldoReceberCentavos - p.valorCentavos, 0),
      reembolsoCriadoCentavos: p.financeiro.refund,
      avisos: [
        cancel
          ? 'Cancelamento integral retorna todas as mercadorias ao estoque. Para unidades impróprias, utilize devolução com perda.'
          : 'A devolução usa os valores e custos históricos da venda.',
        ...(data.itens?.some((i) => i.quantidadePerda)
          ? ['Unidades impróprias retornam e geram perda vinculada na mesma transação.']
          : []),
        ...(p.financeiro.refund
          ? [
              'Será criada obrigação de reembolso pendente. Nenhum dinheiro será pago nesta operação.',
            ]
          : []),
      ],
    };
  }
  function write(input: unknown, cancel: boolean) {
    const e = record(input, ['operacaoId', 'motivo', 'dados', 'revisao']);
    const operacaoId = text(e['operacaoId'], 'operacaoId', 100),
      revisao = text(e['revisao'], 'revisao', 64),
      motivo = text(e['motivo'], 'motivo', 4000);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operacaoId) ||
      !/^[0-9a-f]{64}$/.test(revisao)
    )
      throw new ComercialError('VALIDATION', 'Intenção ou revisão inválida.');
    const data = normalize(e['dados'], cancel);
    const dados = {
      documentoId: data.documentoId,
      dataEfetiva: data.dataEfetiva,
      ...(!cancel ? { itens: data.itens } : {}),
    };
    return db
      .transaction(() => {
        const old = db.prepare('SELECT id FROM operacoes WHERE id=?').get(operacaoId);
        if (!old && fingerprint(data, motivo, cancel) !== revisao)
          throw new ComercialError(
            'VERSION_CONFLICT',
            'A venda, o estoque ou o financeiro mudou. Consulte e revise novamente.',
          );
        return cancel
          ? service.cancelarVenda({ operacaoId, motivo, dados })
          : service.devolverVenda({ operacaoId, motivo, dados });
      })
      .immediate();
  }
  return {
    revisarDevolucaoVenda: (input: unknown) => db.transaction(() => review(input, false))(),
    revisarCancelamentoVenda: (input: unknown) => db.transaction(() => review(input, true))(),
    devolverVenda: (input: unknown) => write(input, false),
    cancelarVenda: (input: unknown) => write(input, true),
  };
}
