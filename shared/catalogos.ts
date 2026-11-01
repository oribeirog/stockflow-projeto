// Platform-independent DTOs. No commercial IPC channels are exposed in delivery 3A.
export type TipoReferencia = 'MARCA' | 'CATEGORIA' | 'FORMA_PAGAMENTO';
export type TipoPessoaCadastro = 'CLIENTE' | 'FORNECEDOR';
export type CodigoErroCadastro =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INACTIVE_REFERENCE'
  | 'IDEMPOTENCY_CONFLICT';
export interface ComandoCadastro<T> {
  operacaoId: string;
  motivo: string;
  dados: T;
}
export interface EntradaReferencia {
  id?: number;
  nome: string;
  ativo?: boolean;
}
export interface Referencia {
  id: number;
  nome: string;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}
export interface EntradaPessoa extends EntradaReferencia {
  tipoPessoa?: 'PF' | 'PJ' | null;
  documento?: string | null;
  telefone?: string | null;
  email?: string | null;
  endereco?: string | null;
  observacoes?: string | null;
}
export interface Pessoa extends Referencia {
  tipoPessoa: 'PF' | 'PJ' | null;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
}
export interface EntradaProduto extends EntradaReferencia {
  sku: string;
  codigoBarras?: string | null;
  marcaId: number;
  categoriaId: number;
  volumeMicrolitros: number;
  concentracao?: string | null;
  descricao?: string | null;
  precoVendaCentavos: number;
  estoqueMinimo: number;
}
export interface Produto extends Referencia {
  sku: string;
  codigoBarras: string | null;
  marcaId: number;
  categoriaId: number;
  volumeMicrolitros: number;
  concentracao: string | null;
  descricao: string | null;
  precoVendaCentavos: number;
  estoqueMinimo: number;
}
export interface ConsultaCadastro {
  busca?: string;
  ativo?: boolean;
  limite?: number;
  deslocamento?: number;
}
export interface HistoricoPreco {
  id: number;
  produtoId: number;
  precoAnteriorCentavos: number | null;
  precoNovoCentavos: number;
  motivo: string;
  registradoEm: string;
  operacaoId: string;
}
