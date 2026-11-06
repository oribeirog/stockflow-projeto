import type {
  VinculoVenda,
  ElegibilidadeEstorno,
  IntencaoFinanceira,
  RevisaoOperacaoFinanceira,
  ResultadoOperacaoFinanceira,
  PaginaFinanceira,
  PaginacaoFinanceira,
  ResultadoConsulta,
} from './financeiro-ipc';
import type { DadosCancelamento, DadosDevolucao, ResumoFinanceiro } from './financeiro';
export type DadosDevolucaoVenda = Omit<DadosDevolucao, 'pagamentos'>;
export interface RevisaoCorrecao {
  dados: DadosDevolucaoVenda | DadosCancelamento;
  motivo: string;
  revisao: string;
  cancelamento: boolean;
  venda: { id: number; numero: string; cliente: string | null; dataComercial: string };
  valorCentavos: number;
  resumoAnterior: ResumoFinanceiro;
  comercialPrevistoCentavos: number;
  saldoPrevistoCentavos: number;
  reembolsoCriadoCentavos: number;
  itens: {
    itemId: number;
    descricao: string;
    sku: string;
    quantidade: number;
    quantidadePerda: number;
    valorCentavos: number;
    custoCentavos: number;
  }[];
  estoque: {
    produtoId: number;
    natureza: string;
    quantidadeDelta: number;
    valorDeltaCentavos: number;
  }[];
  parcelas: {
    parcelaId: number;
    abatimentoCentavos: number;
    saldoAnteriorCentavos: number;
    saldoPrevistoCentavos: number;
  }[];
  avisos: string[];
}
export interface ResultadoCorrecao {
  documentoId: number;
  origemId: number;
  financeiro?: ResumoFinanceiro;
}
export interface ComandoCorrecao<T> {
  operacaoId: string;
  motivo: string;
  dados: T;
  revisao: string;
}
export interface DocumentoCorretivo extends VinculoVenda {
  id: number;
  numero: string;
  origemId: number;
  categoria: 'DEVOLUCAO_VENDA' | 'CANCELAMENTO_VENDA' | 'ESTORNO_DEVOLUCAO';
  estado: 'CONFIRMADO' | 'ESTORNADO';
  dataEfetiva: string;
  totalCentavos: number;
  motivo: string;
  estornadoPorId: number | null;
}
export interface DetalheCorrecao extends DocumentoCorretivo {
  elegibilidadeEstorno: ElegibilidadeEstorno;
  itens: {
    id: number;
    itemOrigemId: number;
    produtoId: number;
    descricaoHistorica: string;
    skuHistorico: string;
    quantidade: number;
    quantidadePerda: number;
    valorLiquidoCentavos: number;
    custoHistoricoCentavos: number;
  }[];
  movimentosEstoque: {
    id: number;
    produtoId: number;
    natureza: string;
    quantidadeDelta: number;
    valorDeltaCentavos: number;
    origemId: number | null;
  }[];
  abatimentos: { parcelaId: number; natureza: 'ABATIMENTO' | 'ESTORNO'; valorCentavos: number }[];
  reembolsoIds: number[];
}
export interface ContextoVendaConsulta extends VinculoVenda {
  dataComercial: string;
  cancelavel: boolean;
  itens: {
    id: number;
    produtoId: number;
    descricaoHistorica: string;
    skuHistorico: string;
    valorLiquidoCentavos: number;
    quantidadeOriginal: number;
    quantidadeDevolvida: number;
    quantidadeDisponivel: number;
  }[];
}
export type DadosEstornoDevolucaoPublico = DadosCancelamento & { vendaId: number };
export interface CorrecoesApi {
  revisarEstornoDevolucaoVenda(input: {
    motivo: string;
    dados: DadosEstornoDevolucaoPublico;
  }): Promise<ResultadoConsulta<RevisaoOperacaoFinanceira>>;
  estornarDevolucaoVenda(
    input: IntencaoFinanceira<DadosEstornoDevolucaoPublico>,
  ): Promise<ResultadoConsulta<ResultadoOperacaoFinanceira>>;
  revisarDevolucaoVenda(input: {
    motivo: string;
    dados: DadosDevolucaoVenda;
  }): Promise<ResultadoConsulta<RevisaoCorrecao>>;
  devolverVenda(
    input: ComandoCorrecao<DadosDevolucaoVenda>,
  ): Promise<ResultadoConsulta<ResultadoCorrecao>>;
  revisarCancelamentoVenda(input: {
    motivo: string;
    dados: DadosCancelamento;
  }): Promise<ResultadoConsulta<RevisaoCorrecao>>;
  cancelarVenda(
    input: ComandoCorrecao<DadosCancelamento>,
  ): Promise<ResultadoConsulta<ResultadoCorrecao>>;
  obterContextoVenda(id: number): Promise<ResultadoConsulta<ContextoVendaConsulta>>;
  listarDocumentos(
    input: PaginacaoFinanceira & { vendaId: number },
  ): Promise<ResultadoConsulta<PaginaFinanceira<DocumentoCorretivo>>>;
  obterDocumento(input: {
    vendaId: number;
    documentoId: number;
  }): Promise<ResultadoConsulta<DetalheCorrecao>>;
}
export const CANAIS_CORRECOES = {
  revisarEstornoDevolucaoVenda: 'correcoes:revisar-estorno-devolucao-venda',
  estornarDevolucaoVenda: 'correcoes:estornar-devolucao-venda',
  revisarDevolucaoVenda: 'correcoes:revisar-devolucao-venda',
  devolverVenda: 'correcoes:devolver-venda',
  revisarCancelamentoVenda: 'correcoes:revisar-cancelamento-venda',
  cancelarVenda: 'correcoes:cancelar-venda',
  obterContextoVenda: 'correcoes:obter-contexto-venda',
  listarDocumentos: 'correcoes:listar-documentos',
  obterDocumento: 'correcoes:obter-documento',
} as const;
