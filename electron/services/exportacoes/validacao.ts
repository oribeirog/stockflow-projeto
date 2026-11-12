import type { PedidoExportacao } from '../../../shared/exportacoes';
import { MODELOS_RELATORIO } from '../../../shared/exportacoes';
import { record, identifier } from '../catalog-validation';
import { commercialDate, ComercialError } from '../comercial';
export function validarPedido(input: unknown): PedidoExportacao {
  const r = record(input, ['modelo', 'filtros']);
  if (!MODELOS_RELATORIO.some((m) => m.id === r['modelo']))
    throw new ComercialError('VALIDATION', 'Modelo inválido.');
  const modelo = r['modelo'] as PedidoExportacao['modelo'];
  const keys: Record<PedidoExportacao['modelo'], string[]> = {
    GERENCIAL: ['dataInicio', 'dataFim', 'clienteId'],
    VENDAS: ['dataInicio', 'dataFim', 'clienteId', 'produtoId', 'ordem'],
    MOVIMENTOS: ['dataInicio', 'dataFim', 'clienteId', 'formaPagamentoId', 'natureza', 'ordem'],
    CONTAS: ['clienteId', 'vendaId', 'vencimentoDe', 'vencimentoAte', 'situacao'],
    REEMBOLSOS: ['clienteId', 'vendaId', 'situacao'],
    ESTOQUE: ['produtoId', 'ativo', 'situacao', 'ordem'],
    DESEMPENHO: ['dataInicio', 'dataFim', 'clienteId'],
  };
  const f = record(r['filtros'], keys[modelo]);
  for (const k of ['clienteId', 'produtoId', 'formaPagamentoId', 'vendaId'])
    if (f[k] !== undefined) identifier(f[k]);
  const invalid = () => {
    throw new ComercialError('VALIDATION', 'Confira os filtros do relatório.');
  };
  if (keys[modelo].includes('dataInicio')) {
    const a = commercialDate(f['dataInicio']),
      b = commercialDate(f['dataFim']);
    const dias = (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
    if (dias < 0 || dias >= 366) invalid();
  }
  for (const k of ['vencimentoDe', 'vencimentoAte']) if (f[k] !== undefined) commercialDate(f[k]);
  if (
    f['vencimentoDe'] &&
    f['vencimentoAte'] &&
    String(f['vencimentoDe']) > String(f['vencimentoAte'])
  )
    invalid();
  const enums: Record<string, readonly string[]> = {
    ordem:
      modelo === 'ESTOQUE' ? ['ID', 'QUANTIDADE_DESC', 'VALOR_DESC'] : ['DATA_DESC', 'VALOR_DESC'],
    natureza: ['RECEBIMENTO', 'ESTORNO_RECEBIMENTO', 'PAGAMENTO_REEMBOLSO', 'ESTORNO_REEMBOLSO'],
    situacao:
      modelo === 'CONTAS'
        ? ['TODAS', 'ABERTAS', 'VENCIDAS', 'A_VENCER', 'QUITADAS']
        : modelo === 'REEMBOLSOS'
          ? ['TODAS', 'PENDENTES', 'QUITADAS', 'ANULADAS']
          : ['TODOS', 'SEM_ESTOQUE', 'BAIXO'],
  };
  for (const [k, values] of Object.entries(enums))
    if (f[k] !== undefined && (typeof f[k] !== 'string' || !values.includes(f[k] as string)))
      invalid();
  if (f['ativo'] !== undefined && typeof f['ativo'] !== 'boolean') invalid();
  return {
    modelo,
    filtros: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)),
  } as PedidoExportacao;
}
