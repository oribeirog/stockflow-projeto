import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonical, identifier, integer, record, text } from './catalog-validation';
import { ComercialError } from './comercial';
import { createCorrectionService } from './correcoes';
import { createPurchaseService } from './compras';
import { total, validarFormaAtiva } from './financeiro';
import { localDay } from './financeiro';
import type {
  ContextoCorrecaoCompra,
  CorrecaoCompraResumo,
  DetalheCorrecaoCompra,
  RevisaoCorrecaoCompra,
} from '../../shared/correcoes-compras-ipc';

const docFields = `id,numero,tipo,estado,data_comercial AS dataEfetiva,criado_em AS registradoEm,observacoes AS motivo,total_centavos AS totalCentavos`;
export function createPurchaseCorrectionService(
  db: Database.Database,
  version: string,
  clock: () => Date = () => new Date(),
) {
  const service = createCorrectionService(db, version, clock);
  const purchases = createPurchaseService(db, version);
  const read = <T>(sql: string, ...args: (number | string)[]) =>
    db.prepare(sql).all(...args) as T[];
  function normalize(raw: unknown, cancel: boolean) {
    const v = record(
      raw,
      cancel
        ? ['documentoId', 'dataEfetiva']
        : ['documentoId', 'dataEfetiva', 'itens', 'pagamentos'],
    );
    if (!cancel && Array.isArray(v['itens']))
      for (const i of v['itens']) record(i, ['itemId', 'quantidade']);
    return service.normalizarCompra(raw, cancel);
  }
  function dados(data: ReturnType<typeof normalize>, cancel: boolean) {
    return {
      documentoId: data.documentoId,
      dataEfetiva: data.dataEfetiva,
      ...(!cancel
        ? {
            itens: data.itens!.map(({ itemId, quantidade }) => ({ itemId, quantidade })),
            pagamentos: data.pagamentos,
          }
        : {}),
    };
  }
  function fingerprint(data: ReturnType<typeof normalize>, motivo: string, cancel: boolean) {
    const id = data.documentoId;
    return createHash('sha256')
      .update(
        canonical({
          data,
          motivo,
          cancel,
          documento: read('SELECT * FROM documentos WHERE id=?', id),
          itens: read('SELECT * FROM itens_documento WHERE documento_id=? ORDER BY id', id),
          correcoes: read('SELECT * FROM documentos WHERE documento_origem_id=? ORDER BY id', id),
          itensCorrecoes: read(
            'SELECT i.* FROM itens_documento i JOIN documentos d ON d.id=i.documento_id WHERE d.documento_origem_id=? ORDER BY i.id',
            id,
          ),
          financeiro: read(
            'SELECT * FROM movimentos_financeiros WHERE documento_id=? OR documento_id IN (SELECT id FROM documentos WHERE documento_origem_id=?) ORDER BY id',
            id,
            id,
          ),
          estoque: read(
            'SELECT * FROM saldos_estoque WHERE produto_id IN (SELECT produto_id FROM itens_documento WHERE documento_id=?) ORDER BY produto_id',
            id,
          ),
          movimentos: read(
            'SELECT id FROM movimentacoes_estoque WHERE produto_id IN (SELECT produto_id FROM itens_documento WHERE documento_id=?) ORDER BY id',
            id,
          ),
          formas: data.pagamentos.map((p) =>
            read('SELECT * FROM formas_pagamento WHERE id=?', p.formaPagamentoId),
          ),
        }),
      )
      .digest('hex');
  }
  function review(input: unknown, cancel: boolean): RevisaoCorrecaoCompra {
    const e = record(input, ['motivo', 'dados']),
      motivo = text(e['motivo'], 'motivo', 4000),
      data = normalize(e['dados'], cancel);
    const p = service.prepararCompra(data, cancel);
    return {
      dados: dados(data, cancel),
      motivo,
      revisao: fingerprint(data, motivo, cancel),
      cancelamento: cancel,
      compra: {
        id: p.d.id,
        numero: p.d.numero,
        fornecedor: p.d.contraparte_nome,
        dataComercial: p.d.data_comercial,
      },
      itens: p.rows,
      valorCentavos: p.valorCentavos,
      totalDocumentoCentavos: cancel ? p.d.total_centavos : p.valorCentavos,
      financeiro: cancel
        ? read<{
            formaHistorica: string;
            valorCentavos: number;
            natureza: string;
            sentido: string;
          }>(
            "SELECT forma_pagamento_historica AS formaHistorica,valor_centavos AS valorCentavos,'ESTORNO_FINANCEIRO' AS natureza,'ENTRADA' AS sentido FROM movimentos_financeiros WHERE documento_id=? AND natureza='PAGAMENTO_COMPRA' ORDER BY id",
            p.d.id,
          )
        : data.pagamentos.map((v) => ({
            formaHistorica: validarFormaAtiva(db, v.formaPagamentoId).nome,
            valorCentavos: v.valorCentavos,
            natureza: 'REEMBOLSO_FORNECEDOR',
            sentido: 'ENTRADA',
          })),
      avisos: cancel
        ? [
            'Cancelamento integral reverte o custo original, incluindo frete e despesas. Os pagamentos originais permanecem e recebem estornos vinculados.',
          ]
        : [
            'A saída usa o custo médio atual oficial; o valor da mercadoria usa o histórico da compra, sem frete ou despesas. A diferença é registrada como ajuste de resultado.',
            'Registre somente reembolso integral já recebido do fornecedor. Não há controle de créditos ou valores pendentes de fornecedor.',
          ],
    };
  }
  function write(input: unknown, cancel: boolean) {
    const e = record(input, ['operacaoId', 'motivo', 'dados', 'revisao']);
    const operacaoId = text(e['operacaoId'], 'operacaoId', 100),
      motivo = text(e['motivo'], 'motivo', 4000),
      revisao = text(e['revisao'], 'revisao', 64);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operacaoId) ||
      !/^[0-9a-f]{64}$/.test(revisao)
    )
      throw new ComercialError('VALIDATION', 'Intenção ou revisão inválida.');
    const data = normalize(e['dados'], cancel);
    return db
      .transaction(() => {
        const old = db.prepare('SELECT id FROM operacoes WHERE id=?').get(operacaoId);
        if (!old && fingerprint(data, motivo, cancel) !== revisao)
          throw new ComercialError(
            'VERSION_CONFLICT',
            'A compra, o estoque ou os pagamentos mudaram.',
          );
        return service[cancel ? 'cancelarCompra' : 'devolverCompra']({
          operacaoId,
          motivo,
          dados: dados(data, cancel),
        });
      })
      .immediate();
  }
  function contexto(input: unknown): ContextoCorrecaoCompra {
    const compra = purchases.obter(identifier(input));
    let impedimentoCancelamento: string | null = null;
    try {
      service.prepararCompra(
        service.normalizarCompra({ documentoId: compra.id, dataEfetiva: localDay(clock()) }, true),
        true,
      );
    } catch (e) {
      if (!(e instanceof ComercialError)) throw e;
      const messages: Record<string, string> = {
        'Compra não confirmada.': 'A compra precisa estar confirmada.',
        'Documento tem devolução anterior.':
          'Há devolução efetiva anterior. Consulte as quantidades restantes para devolução.',
        'Produto tem movimentação posterior.':
          'Há movimentação posterior de estoque. Uma devolução pode ser revisada conforme saldo e custo.',
        'Estoque insuficiente.': 'Estoque insuficiente para reversão integral.',
        'Limite de estoque excedido.': 'Saldo ou valor incompatível com a reversão integral.',
      };
      if (!messages[e.message]) throw e;
      impedimentoCancelamento = messages[e.message];
    }
    return {
      compra,
      cancelavel: impedimentoCancelamento === null,
      impedimentoCancelamento,
      itens: compra.itens.map((i) => {
        const quantidadeDevolvida = total(
          db,
          "SELECT i.quantidade valor FROM itens_documento i JOIN documentos d ON d.id=i.documento_id WHERE i.item_origem_id=? AND d.estado='CONFIRMADO'",
          i.id,
        );
        const quantidadeEstoque = (
          db
            .prepare('SELECT quantidade FROM saldos_estoque WHERE produto_id=?')
            .get(i.produtoId) as { quantidade: number }
        ).quantidade;
        const quantidadeRestante = Math.max(0, i.quantidade - quantidadeDevolvida);
        return {
          id: i.id,
          produtoId: i.produtoId,
          descricao: i.descricaoHistorica!,
          sku: i.skuHistorico!,
          quantidadeOriginal: i.quantidade,
          quantidadeDevolvida,
          quantidadeRestante,
          quantidadeEstoque,
          quantidadeDisponivel:
            compra.estado === 'CONFIRMADO' ? Math.min(quantidadeRestante, quantidadeEstoque) : 0,
          custoHistoricoCentavos: i.valorCustoEstoqueCentavos,
          valorMercadoriaCentavos: i.valorLiquidoCentavos,
        };
      }),
    };
  }
  function listar(input: unknown) {
    const f = record(input, ['compraId', 'aposId', 'limite']),
      id = purchases.obter(identifier(f['compraId'])).id;
    const after =
        f['aposId'] === undefined ? 0 : integer(f['aposId'], 'aposId', 0, Number.MAX_SAFE_INTEGER),
      limit = f['limite'] === undefined ? 25 : integer(f['limite'], 'limite', 1, 200);
    const rows = read<CorrecaoCompraResumo>(
      `SELECT ${docFields} FROM documentos WHERE documento_origem_id=? AND tipo IN ('DEV_COMPRA','ESTORNO') AND id>? ORDER BY id LIMIT ?`,
      id,
      after,
      limit + 1,
    );
    return { itens: rows.slice(0, limit), temMais: rows.length > limit };
  }
  function detalhe(input: unknown): DetalheCorrecaoCompra {
    const f = record(input, ['compraId', 'documentoId']),
      compra = purchases.obter(identifier(f['compraId'])),
      id = identifier(f['documentoId']);
    const d = read<CorrecaoCompraResumo>(
      `SELECT ${docFields} FROM documentos WHERE id=? AND documento_origem_id=? AND tipo IN ('DEV_COMPRA','ESTORNO')`,
      id,
      compra.id,
    )[0];
    if (!d) throw new ComercialError('NOT_FOUND', 'Correção não encontrada.');
    return {
      ...d,
      compraId: compra.id,
      compraNumero: compra.numero,
      fornecedor: compra.contraparteNome,
      itens: read(
        'SELECT id,descricao_historica AS descricao,sku_historico AS sku,quantidade,valor_liquido_centavos AS valorCentavos,valor_custo_estoque_centavos AS custoCentavos,resultado_ajuste_centavos AS ajusteCentavos FROM itens_documento WHERE documento_id=? ORDER BY sequencia',
        id,
      ),
      movimentosEstoque: read(
        'SELECT m.id,m.produto_id AS produtoId,m.natureza,m.quantidade_delta AS quantidadeDelta,m.valor_delta_centavos AS valorDeltaCentavos,m.quantidade_apos AS quantidadeApos,m.valor_apos_centavos AS valorAposCentavos,m.movimentacao_origem_id AS origemId,m.data_efetiva AS dataEfetiva,m.registrado_em AS registradoEm,m.motivo FROM movimentacoes_estoque m JOIN vinculos_estoque_comercial v ON v.movimentacao_id=m.id JOIN itens_documento i ON i.id=v.item_documento_id WHERE i.documento_id=? ORDER BY m.id',
        id,
      ),
      movimentosFinanceiros: read(
        'SELECT m.id,m.natureza,m.sentido,m.valor_centavos AS valorCentavos,m.forma_pagamento_historica AS formaHistorica,m.data_efetiva AS dataEfetiva,m.registrado_em AS registradoEm,m.estorna_movimento_id AS estornaMovimentoId FROM movimentos_financeiros m JOIN documentos d ON d.operacao_confirmacao_id=m.operacao_id WHERE d.id=? ORDER BY m.id',
        id,
      ),
    };
  }
  return {
    obterContexto: (i: unknown) => db.transaction(() => contexto(i))(),
    listarDocumentos: (i: unknown) => db.transaction(() => listar(i))(),
    obterDocumento: (i: unknown) => db.transaction(() => detalhe(i))(),
    revisarDevolucao: (i: unknown) => db.transaction(() => review(i, false))(),
    revisarCancelamento: (i: unknown) => db.transaction(() => review(i, true))(),
    devolver: (i: unknown) => write(i, false),
    cancelar: (i: unknown) => write(i, true),
  };
}
