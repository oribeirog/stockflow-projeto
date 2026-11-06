import type Database from 'better-sqlite3';
import { ComercialError } from './comercial';
import { prepararEstornoFinanceiro, many } from './financeiro';
import { createCorrectionService } from './correcoes';
import type { ElegibilidadeEstorno, DependenciaEstorno } from '../../shared/financeiro-ipc';
const publicMessages: Record<string, string> = {
  'Movimento indisponível para estorno.':
    'Movimento já estornado ou natureza incompatível. Não existe estorno de estorno.',
  'Recebimento sustenta correção; desfaça dependências primeiro.':
    'Recebimento sustenta correção. Resolva as correções vinculadas antes de estornar este movimento.',
  'Devolução indisponível.':
    'Somente devoluções de venda confirmadas podem ser estornadas. Cancelamentos integrais não podem ser desfeitos.',
  'Produto tem movimentação posterior.':
    'Há movimentações posteriores de estoque incompatíveis. Não serão revertidas automaticamente.',
  'Estorne pagamentos dependentes primeiro.':
    'Estorne individualmente os pagamentos de reembolso dependentes antes desta devolução.',
  'Documento não tem movimentos reversíveis.': 'Documento sem movimentos reversíveis.',
};
export function inspecionarEstorno(
  db: Database.Database,
  vendaId: number,
  id: number,
  devolucao: boolean,
  dataEfetiva: string,
): ElegibilidadeEstorno {
  const dependencias: DependenciaEstorno[] = devolucao
    ? [
        ...many<{ id: number }>(
          db,
          "SELECT DISTINCT m.id FROM movimentos_financeiros m JOIN alocacoes_reembolso a ON a.movimento_financeiro_id=m.id JOIN origens_reembolso o ON o.id=a.origem_reembolso_id JOIN reembolsos_cliente r ON r.id=o.reembolso_id WHERE r.documento_correcao_id=? AND m.natureza='REEMBOLSO_CLIENTE' AND NOT EXISTS(SELECT 1 FROM movimentos_financeiros e WHERE e.estorna_movimento_id=m.id)",
          id,
        ).map((m) => ({ tipo: 'movimento' as const, id: m.id, vendaId })),
        ...many<{ id: number; produtoId: number }>(
          db,
          'SELECT m.id,m.produto_id AS produtoId FROM movimentacoes_estoque m WHERE EXISTS(SELECT 1 FROM movimentacoes_estoque x JOIN vinculos_estoque_comercial v ON v.movimentacao_id=x.id JOIN itens_documento i ON i.id=v.item_documento_id WHERE i.documento_id=? AND x.produto_id=m.produto_id) AND m.id>(SELECT max(x.id) FROM movimentacoes_estoque x JOIN vinculos_estoque_comercial v ON v.movimentacao_id=x.id JOIN itens_documento i ON i.id=v.item_documento_id WHERE i.documento_id=? AND x.produto_id=m.produto_id) ORDER BY m.id',
          id,
          id,
        ).map((m) => ({ tipo: 'estoque' as const, ...m, vendaId })),
      ]
    : many<{ id: number }>(
        db,
        "SELECT DISTINCT d.id FROM documentos d WHERE d.estado='CONFIRMADO' AND (EXISTS(SELECT 1 FROM abatimentos_parcela b JOIN alocacoes_recebimento a ON a.parcela_id=b.parcela_id WHERE b.documento_correcao_id=d.id AND b.natureza='ABATIMENTO' AND a.movimento_financeiro_id=?) OR EXISTS(SELECT 1 FROM reembolsos_cliente r JOIN origens_reembolso o ON o.reembolso_id=r.id JOIN alocacoes_recebimento a ON a.id=o.alocacao_recebimento_id WHERE r.documento_correcao_id=d.id AND a.movimento_financeiro_id=?)) ORDER BY d.id",
        id,
        id,
      ).map((d) => ({ tipo: 'correcao' as const, id: d.id, vendaId }));
  try {
    if (devolucao) {
      const d = db.prepare('SELECT tipo,documento_origem_id FROM documentos WHERE id=?').get(id) as
        | { tipo: string; documento_origem_id: number }
        | undefined;
      if (d?.tipo !== 'DEV_VENDA' || d.documento_origem_id !== vendaId)
        throw new ComercialError('INVALID_STATE', 'Devolução indisponível.');
      createCorrectionService(db, 'query').prepararEstornoDevolucao({
        documentoId: id,
        dataEfetiva,
      });
    } else {
      const m = db
        .prepare('SELECT natureza FROM movimentos_financeiros WHERE id=? AND documento_id=?')
        .get(id, vendaId) as { natureza: string } | undefined;
      const natureza =
        m?.natureza === 'RECEBIMENTO_CLIENTE' ? 'RECEBIMENTO_CLIENTE' : 'REEMBOLSO_CLIENTE';
      prepararEstornoFinanceiro(db, { movimentoId: id, dataEfetiva }, natureza);
    }
    return {
      permitido: true,
      motivo: 'Estorno integral e individual permitido no estado consultado.',
      dependencias: [],
    };
  } catch (e) {
    if (e instanceof ComercialError)
      return {
        permitido: false,
        motivo:
          publicMessages[e.message] ?? 'Não é possível estornar com segurança no estado atual.',
        dependencias,
      };
    throw e;
  }
}
