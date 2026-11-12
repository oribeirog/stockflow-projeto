import type { Result } from './contracts';
import type * as R from './relatorios-ipc';

export const MODELOS_RELATORIO = [
  {
    id: 'GERENCIAL',
    nome: 'Gerencial',
    descricao: 'Fluxos do período, coorte e posições atuais, identificados separadamente.',
  },
  {
    id: 'VENDAS',
    nome: 'Vendas',
    descricao: 'Vendas da coorte selecionada com valores históricos e líquido atual.',
  },
  {
    id: 'MOVIMENTOS',
    nome: 'Recebimentos e movimentos',
    descricao: 'Dinheiro de clientes pela data efetiva, incluindo reembolsos e estornos.',
  },
  {
    id: 'CONTAS',
    nome: 'Contas a receber',
    descricao: 'Parcelas e saldos atuais. Datas filtram vencimentos, sem reconstrução histórica.',
  },
  {
    id: 'REEMBOLSOS',
    nome: 'Reembolsos',
    descricao: 'Obrigações atuais, pagamentos e estornos históricos. Anuladas em separado.',
  },
  {
    id: 'ESTOQUE',
    nome: 'Estoque',
    descricao: 'Saldos atuais de todos os produtos, inclusive inativos. Não é estoque histórico.',
  },
  {
    id: 'DESEMPENHO',
    nome: 'Desempenho de produtos e clientes',
    descricao:
      'Produtos por fluxo líquido e clientes pelo valor atual da coorte, sem equivalência com recebimentos.',
  },
] as const;
export type ModeloRelatorio = (typeof MODELOS_RELATORIO)[number]['id'];
type SemPagina<T> = Omit<T, 'limite' | 'deslocamento'>;
export type PedidoExportacao =
  | { modelo: 'GERENCIAL'; filtros: R.PeriodoRelatorio & { clienteId?: number } }
  | { modelo: 'VENDAS'; filtros: SemPagina<R.ConsultaVendasRelatorio> }
  | { modelo: 'MOVIMENTOS'; filtros: SemPagina<R.ConsultaMovimentosRelatorio> }
  | { modelo: 'CONTAS'; filtros: SemPagina<R.ConsultaContasRelatorio> }
  | { modelo: 'REEMBOLSOS'; filtros: SemPagina<R.ConsultaReembolsosRelatorio> }
  | { modelo: 'ESTOQUE'; filtros: SemPagina<R.ConsultaEstoqueRelatorio> }
  | { modelo: 'DESEMPENHO'; filtros: R.PeriodoRelatorio & { clienteId?: number } };
export type ResultadoExportacao =
  | { cancelado: true }
  | {
      cancelado: false;
      nome: string;
      formato: 'xlsx' | 'pdf';
      bytes: number;
      geradoEm: string;
      registros: number;
    };
export interface ExportacoesApi {
  exportarExcel(input: PedidoExportacao): Promise<Result<ResultadoExportacao>>;
  exportarPdf(input: PedidoExportacao): Promise<Result<ResultadoExportacao>>;
}
export const CANAIS_EXPORTACOES = {
  exportarExcel: 'exportacoes:excel',
  exportarPdf: 'exportacoes:pdf',
} as const;
export const LIMITES_EXPORTACAO = {
  linhas: 5000,
  dadosBytes: 12 * 1024 * 1024,
  arquivoBytes: 32 * 1024 * 1024,
  coletaMs: 10000,
  geracaoMs: 45000,
} as const;
