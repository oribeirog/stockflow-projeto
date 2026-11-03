import type Database from 'better-sqlite3';
import type {
  Compra,
  DetalheCompra,
  PagamentoCompra,
  PaginaCompras,
  ResumoCompra,
} from '../../shared/compras-ipc';
import type { DocumentoComercial } from '../../shared/comercial';
import { createCommercialService, ComercialError } from './comercial';
import { identifier, integer, record, text } from './catalog-validation';
import { somar } from '../domain/comercial';

// Purchase-only boundary. Existing commercial transactions own every business effect.
export function createPurchaseService(db: Database.Database, version: string) {
  const commercial = createCommercialService(db, version);
  function purchase(id: unknown) {
    const value = identifier(id);
    const row = db.prepare("SELECT id FROM documentos WHERE id=? AND tipo='COMPRA'").get(value);
    if (!row) throw new ComercialError('NOT_FOUND', 'Compra não encontrada.');
    return value;
  }
  function project(d: DocumentoComercial): Compra {
    if (d.tipo !== 'COMPRA') throw new ComercialError('NOT_FOUND', 'Compra não encontrada.');
    const {
      id,
      numero,
      estado,
      versao,
      fornecedorId,
      contraparteNome,
      contraparteDocumento,
      dataComercial,
      subtotalCentavos,
      descontoItensCentavos,
      descontoGlobalCentavos,
      freteCentavos,
      despesasDiretasCentavos,
      totalCentavos,
      observacoes,
      criadoEm,
      confirmadoEm,
      operacaoConfirmacaoId,
    } = d;
    return {
      id,
      numero,
      estado,
      versao,
      fornecedorId,
      contraparteNome,
      contraparteDocumento,
      dataComercial,
      subtotalCentavos,
      descontoItensCentavos,
      descontoGlobalCentavos,
      freteCentavos,
      despesasDiretasCentavos,
      totalCentavos,
      observacoes,
      criadoEm,
      confirmadoEm,
      operacaoConfirmacaoId,
      itens: d.itens.map((i) => ({
        ...i,
        custoAquisicaoCentavos: somar([
          i.valorLiquidoCentavos,
          i.freteRateadoCentavos,
          i.despesasRateadasCentavos,
        ]),
      })),
    };
  }
  function write(
    action: 'salvarRascunho' | 'confirmar' | 'descartarRascunho',
    input: unknown,
  ): Compra {
    const envelope = record(input, ['operacaoId', 'motivo', 'dados']);
    text(envelope['operacaoId'], 'operacaoId', 100);
    text(envelope['motivo'], 'motivo', 4000);
    const keys =
      action === 'salvarRascunho'
        ? [
            'id',
            'versaoEsperada',
            'fornecedorId',
            'dataComercial',
            'itens',
            'descontoGlobal',
            'freteCentavos',
            'despesasDiretasCentavos',
            'observacoes',
          ]
        : action === 'confirmar'
          ? ['id', 'versaoEsperada', 'pagamentos']
          : ['id', 'versaoEsperada'];
    const dados = record(envelope['dados'], keys);
    return db
      .transaction(() => {
        if (action !== 'salvarRascunho' || dados['id'] !== undefined) purchase(dados['id']);
        return project(
          commercial[action]({
            ...envelope,
            dados: action === 'salvarRascunho' ? { ...dados, tipo: 'COMPRA' } : dados,
          }),
        );
      })
      .immediate();
  }
  return {
    salvarRascunho: (input: unknown) => write('salvarRascunho', input),
    confirmar: (input: unknown) => write('confirmar', input),
    descartarRascunho: (input: unknown) => write('descartarRascunho', input),
    obter: (input: unknown): DetalheCompra =>
      db.transaction(() => {
        const id = purchase(input),
          d = project(commercial.consultar(id));
        if (d.estado === 'RASCUNHO') {
          const supplier = db
            .prepare('SELECT nome,documento FROM fornecedores WHERE id=?')
            .get(d.fornecedorId) as { nome: string; documento: string | null } | undefined;
          d.contraparteNome = supplier?.nome ?? null;
          d.contraparteDocumento = supplier?.documento ?? null;
          for (const i of d.itens) {
            const p = db.prepare('SELECT nome,sku FROM produtos WHERE id=?').get(i.produtoId) as {
              nome: string;
              sku: string;
            };
            i.descricaoHistorica = p.nome;
            i.skuHistorico = p.sku;
          }
        }
        const pagamentos = db
          .prepare(
            "SELECT id,forma_pagamento_id AS formaPagamentoId,forma_pagamento_historica AS nomeHistorico,valor_centavos AS valorCentavos,data_efetiva AS dataEfetiva,registrado_em AS registradoEm FROM movimentos_financeiros WHERE documento_id=? AND natureza='PAGAMENTO_COMPRA' ORDER BY id",
          )
          .all(id) as PagamentoCompra[];
        return { ...d, pagamentos };
      })(),
    listar: (input: unknown): PaginaCompras => {
      const f = record(input, ['estado', 'fornecedorId', 'limite', 'deslocamento']);
      const estado = f['estado'] ?? null;
      if (
        estado !== null &&
        !['RASCUNHO', 'CONFIRMADO', 'DESCARTADO', 'ESTORNADO'].includes(estado as string)
      )
        throw new ComercialError('VALIDATION', 'Estado inválido.');
      const supplier = f['fornecedorId'] === undefined ? null : identifier(f['fornecedorId']);
      const limit = f['limite'] === undefined ? 25 : integer(f['limite'], 'limite', 1, 200);
      const offset =
        f['deslocamento'] === undefined
          ? 0
          : integer(f['deslocamento'], 'deslocamento', 0, 1_000_000_000);
      const rows = db
        .prepare(
          `SELECT d.id,d.numero,d.estado,d.fornecedor_id AS fornecedorId,CASE WHEN d.estado='RASCUNHO' THEN f.nome ELSE d.contraparte_nome END AS contraparteNome,d.data_comercial AS dataComercial,d.total_centavos AS totalCentavos FROM documentos d LEFT JOIN fornecedores f ON f.id=d.fornecedor_id WHERE d.tipo='COMPRA' AND (? IS NULL OR d.estado=?) AND (? IS NULL OR d.fornecedor_id=?) ORDER BY d.id DESC LIMIT ? OFFSET ?`,
        )
        .all(
          estado as string | null,
          estado as string | null,
          supplier,
          supplier,
          limit + 1,
          offset,
        ) as ResumoCompra[];
      return { itens: rows.slice(0, limit), temMais: rows.length > limit };
    },
  };
}
