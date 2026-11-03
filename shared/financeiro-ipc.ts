import type { ResumoFinanceiro } from './financeiro';
import type { ResultadoCompra } from './compras-ipc';

export type ResultadoConsulta<T> = ResultadoCompra<T>;
export interface PaginaFinanceira<T> {
  itens: T[];
  temMais: boolean;
  dataReferencia: string;
}
export interface PaginacaoFinanceira {
  limite?: number;
  deslocamento?: number;
}
export interface FiltrosFinanceiros extends PaginacaoFinanceira {
  clienteId?: number;
  vendaId?: number;
}
export type SituacaoParcela =
  | 'EM_ABERTO'
  | 'PENDENTE'
  | 'PARCIALMENTE_PAGO'
  | 'QUITADO'
  | 'VENCIDO'
  | 'TODAS';
export interface ConsultaParcelas extends FiltrosFinanceiros {
  situacao?: SituacaoParcela;
  vencimentoDe?: string;
  vencimentoAte?: string;
}
export interface VinculoVenda {
  vendaId: number;
  vendaNumero: string;
  vendaEstado: 'CONFIRMADO' | 'ESTORNADO';
  clienteId: number | null;
  clienteNomeHistorico: string | null;
  clienteAtivo: boolean | null;
}
export interface ParcelaConsulta extends VinculoVenda {
  id: number;
  numero: number;
  vencimento: string;
  tipo: 'REGULAR' | 'ENTRADA';
  modalidadeVenda: 'A_VISTA' | 'A_PRAZO';
  valorOriginalCentavos: number;
  recebimentosCentavos: number;
  abatimentosCentavos: number;
  saldoCentavos: number;
  status: 'PENDENTE' | 'PARCIALMENTE_PAGO' | 'QUITADO' | 'VENCIDO';
  recebimentoParcial: boolean;
}
export interface ResumoConsulta extends ResumoFinanceiro {
  recebidoLiquidoCentavos: number;
  reembolsoPagoLiquidoCentavos: number;
  obrigacoesAtivasCentavos: number;
}
export interface VendaFinanceira extends VinculoVenda {
  dataComercial: string;
  resumo: ResumoConsulta;
}
export interface MovimentoConsultaFinanceiro {
  id: number;
  vendaId: number;
  natureza: 'RECEBIMENTO_CLIENTE' | 'REEMBOLSO_CLIENTE' | 'ESTORNO_FINANCEIRO';
  sentido: 'ENTRADA' | 'SAIDA';
  valorCentavos: number;
  formaPagamentoId: number;
  formaHistorica: string;
  dataEfetiva: string;
  registradoEm: string;
  operacaoId: string;
  motivo: string;
  estornaMovimentoId: number | null;
  estornadoPorId: number | null;
}
export interface ConsultaMovimentosFinanceiros {
  limite?: number;
  vendaId: number;
  aposId?: number;
  parcelaId?: number;
  reembolsoId?: number;
}
export interface AlocacaoConsulta {
  id: number;
  natureza: 'APLICACAO' | 'PAGAMENTO' | 'ESTORNO';
  valorCentavos: number;
  parcelaId: number | null;
  reembolsoId: number | null;
  estornaAlocacaoId: number | null;
}
export interface DetalheMovimentoFinanceiro extends MovimentoConsultaFinanceiro {
  alocacoes: AlocacaoConsulta[];
}
export interface ConsultaReembolsos extends FiltrosFinanceiros {
  situacao?: 'ATIVAS' | 'PENDENTES' | 'QUITADAS' | 'ANULADAS' | 'TODAS';
}
export interface ReembolsoConsulta extends VinculoVenda {
  id: number;
  correcaoId: number;
  correcaoNumero: string;
  dataEfetiva: string;
  ativa: boolean;
  valorOriginalCentavos: number;
  pagosCentavos: number;
  estornosCentavos: number;
  pagoLiquidoCentavos: number;
  saldoExigivelCentavos: number;
}
export interface DetalheParcela extends ParcelaConsulta {
  dataReferencia: string;
  abatimentos: {
    id: number;
    correcaoId: number;
    natureza: 'ABATIMENTO' | 'ESTORNO';
    valorCentavos: number;
    estornaAbatimentoId: number | null;
  }[];
}
export interface DetalheReembolso extends ReembolsoConsulta {
  dataReferencia: string;
  origens: { movimentoId: number; parcelaId: number; valorCentavos: number }[];
}
export interface FinanceiroApi {
  listarParcelas(
    input: ConsultaParcelas,
  ): Promise<ResultadoConsulta<PaginaFinanceira<ParcelaConsulta>>>;
  obterParcela(id: number): Promise<ResultadoConsulta<DetalheParcela>>;
  obterVenda(id: number): Promise<ResultadoConsulta<VendaFinanceira>>;
  listarMovimentos(
    input: ConsultaMovimentosFinanceiros,
  ): Promise<ResultadoConsulta<PaginaFinanceira<MovimentoConsultaFinanceiro>>>;
  obterMovimento(input: {
    vendaId: number;
    movimentoId: number;
  }): Promise<ResultadoConsulta<DetalheMovimentoFinanceiro>>;
  listarReembolsos(
    input: ConsultaReembolsos,
  ): Promise<ResultadoConsulta<PaginaFinanceira<ReembolsoConsulta>>>;
  obterReembolso(input: {
    vendaId: number;
    reembolsoId: number;
  }): Promise<ResultadoConsulta<DetalheReembolso>>;
}
export const CANAIS_FINANCEIRO = {
  listarParcelas: 'financeiro:listar-parcelas',
  obterParcela: 'financeiro:obter-parcela',
  obterVenda: 'financeiro:obter-venda',
  listarMovimentos: 'financeiro:listar-movimentos',
  obterMovimento: 'financeiro:obter-movimento',
  listarReembolsos: 'financeiro:listar-reembolsos',
  obterReembolso: 'financeiro:obter-reembolso',
} as const;
