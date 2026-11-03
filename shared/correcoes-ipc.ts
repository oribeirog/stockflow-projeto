import type {
  VinculoVenda,
  PaginaFinanceira,
  PaginacaoFinanceira,
  ResultadoConsulta,
} from './financeiro-ipc';
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
  itens: {
    id: number;
    produtoId: number;
    descricaoHistorica: string;
    quantidadeOriginal: number;
    quantidadeDevolvida: number;
    quantidadeDisponivel: number;
  }[];
}
export interface CorrecoesApi {
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
  obterContextoVenda: 'correcoes:obter-contexto-venda',
  listarDocumentos: 'correcoes:listar-documentos',
  obterDocumento: 'correcoes:obter-documento',
} as const;
