import type { DetalheCompra, ResultadoCompra } from './compras-ipc';
import type { DadosCancelamento, PagamentoFinanceiro } from './financeiro';
import type { ComandoCorrecao, ResultadoCorrecao } from './correcoes-ipc';

export interface DadosDevolucaoCompra extends DadosCancelamento {
  itens: { itemId: number; quantidade: number }[];
  pagamentos: PagamentoFinanceiro[];
}
export interface ItemRevisaoCompra {
  itemId: number;
  produtoId: number;
  descricao: string;
  sku: string;
  quantidade: number;
  valorCentavos: number;
  custoCentavos: number;
  ajusteCentavos: number;
  quantidadeAntes: number;
  valorAntesCentavos: number;
  quantidadeApos: number;
  valorAposCentavos: number;
}
export interface MovimentoCompra {
  id: number;
  natureza: string;
  sentido: string;
  valorCentavos: number;
  formaHistorica: string;
  dataEfetiva: string;
  registradoEm: string;
  estornaMovimentoId: number | null;
}
export interface CorrecaoCompraResumo {
  id: number;
  numero: string;
  tipo: string;
  estado: string;
  dataEfetiva: string;
  registradoEm: string;
  motivo: string;
  totalCentavos: number;
}
export interface ContextoCorrecaoCompra {
  compra: DetalheCompra;
  cancelavel: boolean;
  impedimentoCancelamento: string | null;
  itens: {
    id: number;
    produtoId: number;
    descricao: string;
    sku: string;
    quantidadeOriginal: number;
    quantidadeDevolvida: number;
    quantidadeRestante: number;
    quantidadeEstoque: number;
    quantidadeDisponivel: number;
    custoHistoricoCentavos: number;
    valorMercadoriaCentavos: number;
  }[];
}
export interface RevisaoCorrecaoCompra {
  dados: DadosCancelamento | DadosDevolucaoCompra;
  motivo: string;
  revisao: string;
  cancelamento: boolean;
  compra: { id: number; numero: string; fornecedor: string | null; dataComercial: string };
  itens: ItemRevisaoCompra[];
  valorCentavos: number;
  totalDocumentoCentavos: number;
  financeiro: {
    formaHistorica: string;
    valorCentavos: number;
    natureza: string;
    sentido: string;
  }[];
  avisos: string[];
}
export interface DetalheCorrecaoCompra extends CorrecaoCompraResumo {
  compraId: number;
  compraNumero: string;
  fornecedor: string | null;
  itens: {
    id: number;
    descricao: string;
    sku: string;
    quantidade: number;
    valorCentavos: number;
    custoCentavos: number;
    ajusteCentavos: number;
  }[];
  movimentosEstoque: {
    id: number;
    produtoId: number;
    natureza: string;
    quantidadeDelta: number;
    valorDeltaCentavos: number;
    quantidadeApos: number;
    valorAposCentavos: number;
    origemId: number;
    dataEfetiva: string;
    registradoEm: string;
    motivo: string;
  }[];
  movimentosFinanceiros: MovimentoCompra[];
}
export interface CorrecoesComprasApi {
  obterContexto(id: number): Promise<ResultadoCompra<ContextoCorrecaoCompra>>;
  listarDocumentos(input: {
    compraId: number;
    aposId?: number;
    limite?: number;
  }): Promise<ResultadoCompra<{ itens: CorrecaoCompraResumo[]; temMais: boolean }>>;
  obterDocumento(input: {
    compraId: number;
    documentoId: number;
  }): Promise<ResultadoCompra<DetalheCorrecaoCompra>>;
  revisarDevolucao(input: {
    motivo: string;
    dados: DadosDevolucaoCompra;
  }): Promise<ResultadoCompra<RevisaoCorrecaoCompra>>;
  revisarCancelamento(input: {
    motivo: string;
    dados: DadosCancelamento;
  }): Promise<ResultadoCompra<RevisaoCorrecaoCompra>>;
  devolver(
    command: ComandoCorrecao<DadosDevolucaoCompra>,
  ): Promise<ResultadoCompra<ResultadoCorrecao>>;
  cancelar(
    command: ComandoCorrecao<DadosCancelamento>,
  ): Promise<ResultadoCompra<ResultadoCorrecao>>;
}
export const CANAIS_CORRECOES_COMPRAS = {
  obterContexto: 'correcoes-compras:obter-contexto',
  listarDocumentos: 'correcoes-compras:listar-documentos',
  obterDocumento: 'correcoes-compras:obter-documento',
  revisarDevolucao: 'correcoes-compras:revisar-devolucao',
  revisarCancelamento: 'correcoes-compras:revisar-cancelamento',
  devolver: 'correcoes-compras:devolver',
  cancelar: 'correcoes-compras:cancelar',
} as const;
