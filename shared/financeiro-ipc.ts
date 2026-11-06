import type {
  ResumoFinanceiro,
  DadosRecebimento,
  DadosPagamentoReembolso,
  DadosEstornoFinanceiro,
} from './financeiro';
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
  elegibilidadeEstorno: ElegibilidadeEstorno;
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
export interface DependenciaEstorno {
  tipo: 'correcao' | 'movimento' | 'estoque';
  id: number;
  vendaId: number;
  produtoId?: number;
}
export interface ElegibilidadeEstorno {
  permitido: boolean;
  motivo: string;
  dependencias: DependenciaEstorno[];
}
export type DadosPagamentoReembolsoPublico = DadosPagamentoReembolso & { vendaId: number };
export type DadosEstornoPublico = DadosEstornoFinanceiro & { vendaId: number };
export interface IntencaoFinanceira<T> {
  operacaoId: string;
  motivo: string;
  dados: T;
  revisao: string;
}
export type TipoOperacaoFinanceira =
  | 'PAGAR_REEMBOLSO'
  | 'ESTORNAR_RECEBIMENTO'
  | 'ESTORNAR_REEMBOLSO'
  | 'ESTORNAR_DEVOLUCAO';
export interface RevisaoOperacaoFinanceira {
  tipo: TipoOperacaoFinanceira;
  dados:
    | DadosPagamentoReembolsoPublico
    | DadosEstornoPublico
    | { vendaId: number; documentoId: number; dataEfetiva: string };
  motivo: string;
  revisao: string;
  venda: VendaFinanceira;
  anterior: ResumoFinanceiro;
  previsto: ResumoFinanceiro;
  valorCentavos: number;
  obrigacoes: {
    id: number;
    originalCentavos: number;
    pagoAnteriorCentavos: number;
    pagoPrevistoCentavos: number;
    saldoAnteriorCentavos: number;
    saldoPrevistoCentavos: number;
    ativaPrevista: boolean;
  }[];
  parcelas: {
    id: number;
    saldoAnteriorCentavos: number;
    saldoPrevistoCentavos: number;
    abatimentoRevertidoCentavos: number;
  }[];
  estoque: {
    id: number;
    produtoId: number;
    natureza: string;
    quantidadeDelta: number;
    valorDeltaCentavos: number;
  }[];
  itens: { descricao: string; sku: string; quantidade: number; custoCentavos: number }[];
  formas: { id: number; nome: string; valorCentavos: number }[];
  avisos: string[];
}
export interface ResultadoOperacaoFinanceira {
  movimentos?: number[];
  movimentoId?: number;
  documentoId?: number;
  origemId?: number;
  financeiro?: ResumoFinanceiro;
}
export interface FinanceiroApi {
  revisarPagamentoReembolso(input: {
    motivo: string;
    dados: DadosPagamentoReembolsoPublico;
  }): Promise<ResultadoConsulta<RevisaoOperacaoFinanceira>>;
  pagarReembolso(
    input: IntencaoFinanceira<DadosPagamentoReembolsoPublico>,
  ): Promise<ResultadoConsulta<ResultadoOperacaoFinanceira>>;
  revisarEstornoRecebimento(input: {
    motivo: string;
    dados: DadosEstornoPublico;
  }): Promise<ResultadoConsulta<RevisaoOperacaoFinanceira>>;
  estornarRecebimento(
    input: IntencaoFinanceira<DadosEstornoPublico>,
  ): Promise<ResultadoConsulta<ResultadoOperacaoFinanceira>>;
  revisarEstornoReembolso(input: {
    motivo: string;
    dados: DadosEstornoPublico;
  }): Promise<ResultadoConsulta<RevisaoOperacaoFinanceira>>;
  estornarReembolso(
    input: IntencaoFinanceira<DadosEstornoPublico>,
  ): Promise<ResultadoConsulta<ResultadoOperacaoFinanceira>>;
  revisarRecebimento(input: {
    motivo: string;
    dados: DadosRecebimento;
  }): Promise<ResultadoConsulta<RevisaoRecebimento>>;
  registrarRecebimento(input: {
    operacaoId: string;
    motivo: string;
    dados: DadosRecebimento;
    revisao: string;
  }): Promise<ResultadoConsulta<ResultadoRecebimento>>;
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
export interface RevisaoRecebimento {
  saldoPrevistoCentavos: number;
  efeitos: {
    parcelaId: number;
    saldoAnteriorCentavos: number;
    saldoPrevistoCentavos: number;
    statusPrevisto: string;
  }[];
  dados: DadosRecebimento;
  motivo: string;
  revisao: string;
  venda: { id: number; numero: string; versao: number; estado: string; cliente: string | null };
  formas: { id: number; nome: string; ativo: number }[];
  plano: {
    parcelas: {
      id: number;
      numero: number;
      vencimento: string;
      saldoCentavos: number;
      status: string;
    }[];
    totalCentavos: number;
    alocacoes: { parcelaId: number; valorCentavos: number }[];
  };
  resumo: ResumoFinanceiro;
}
export interface ResultadoRecebimento {
  movimentos: number[];
  financeiro: ResumoFinanceiro;
}
export const CANAIS_FINANCEIRO = {
  revisarPagamentoReembolso: 'financeiro:revisar-pagamento-reembolso',
  pagarReembolso: 'financeiro:pagar-reembolso',
  revisarEstornoRecebimento: 'financeiro:revisar-estorno-recebimento',
  estornarRecebimento: 'financeiro:estornar-recebimento',
  revisarEstornoReembolso: 'financeiro:revisar-estorno-reembolso',
  estornarReembolso: 'financeiro:estornar-reembolso',
  revisarRecebimento: 'financeiro:revisar-recebimento',
  registrarRecebimento: 'financeiro:registrar-recebimento',
  listarParcelas: 'financeiro:listar-parcelas',
  obterParcela: 'financeiro:obter-parcela',
  obterVenda: 'financeiro:obter-venda',
  listarMovimentos: 'financeiro:listar-movimentos',
  obterMovimento: 'financeiro:obter-movimento',
  listarReembolsos: 'financeiro:listar-reembolsos',
  obterReembolso: 'financeiro:obter-reembolso',
} as const;
