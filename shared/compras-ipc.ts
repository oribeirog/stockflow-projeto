import type {
  ComandoComercial,
  DadosRascunho,
  DocumentoComercial,
  EstadoDocumento,
  ItemComercial,
  PagamentoConfirmacao,
  CodigoErroComercial,
} from './comercial';

export type DadosRascunhoCompra = Omit<DadosRascunho, 'tipo' | 'clienteId' | 'modalidadeVenda'>;
export interface DadosConfirmacaoCompra {
  id: number;
  versaoEsperada: number;
  pagamentos: PagamentoConfirmacao[];
}
export interface DadosDescarteCompra {
  id: number;
  versaoEsperada: number;
}
export interface ConsultaCompras {
  estado?: EstadoDocumento;
  fornecedorId?: number;
  limite?: number;
  deslocamento?: number;
}
export interface PagamentoCompra {
  id: number;
  formaPagamentoId: number;
  nomeHistorico: string;
  valorCentavos: number;
  dataEfetiva: string;
  registradoEm: string;
}
export type Compra = Pick<
  DocumentoComercial,
  | 'id'
  | 'numero'
  | 'estado'
  | 'versao'
  | 'fornecedorId'
  | 'contraparteNome'
  | 'contraparteDocumento'
  | 'dataComercial'
  | 'subtotalCentavos'
  | 'descontoItensCentavos'
  | 'descontoGlobalCentavos'
  | 'freteCentavos'
  | 'despesasDiretasCentavos'
  | 'totalCentavos'
  | 'observacoes'
  | 'criadoEm'
  | 'confirmadoEm'
  | 'operacaoConfirmacaoId'
> & { itens: (ItemComercial & { custoAquisicaoCentavos: number })[] };
export interface DetalheCompra extends Compra {
  pagamentos: PagamentoCompra[];
}
export type ResumoCompra = Pick<
  Compra,
  | 'id'
  | 'numero'
  | 'estado'
  | 'fornecedorId'
  | 'contraparteNome'
  | 'dataComercial'
  | 'totalCentavos'
>;
export interface PaginaCompras {
  itens: ResumoCompra[];
  temMais: boolean;
}
export type CodigoErroCompra =
  | CodigoErroComercial
  | 'INTERNAL_ERROR'
  | 'IPC_UNAVAILABLE'
  | 'DESKTOP_UNAVAILABLE';
export type ResultadoCompra<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CodigoErroCompra; message: string } };
export interface ComprasApi {
  listar(input: ConsultaCompras): Promise<ResultadoCompra<PaginaCompras>>;
  obter(id: number): Promise<ResultadoCompra<DetalheCompra>>;
  salvarRascunho(command: ComandoComercial<DadosRascunhoCompra>): Promise<ResultadoCompra<Compra>>;
  confirmar(command: ComandoComercial<DadosConfirmacaoCompra>): Promise<ResultadoCompra<Compra>>;
  descartarRascunho(
    command: ComandoComercial<DadosDescarteCompra>,
  ): Promise<ResultadoCompra<Compra>>;
}
export const CANAIS_COMPRAS = {
  listar: 'compras:listar',
  obter: 'compras:obter',
  salvarRascunho: 'compras:salvar-rascunho',
  confirmar: 'compras:confirmar',
  descartarRascunho: 'compras:descartar-rascunho',
} as const;
export const MENSAGENS_COMPRAS: Record<CodigoErroCompra, string> = {
  VALIDATION: 'Confira os campos, pagamentos e limites informados.',
  NOT_FOUND: 'Compra ou referência não encontrada.',
  INACTIVE_REFERENCE:
    'Fornecedor, produto ou forma de pagamento inativo. Atualize as referências e revise novamente.',
  VERSION_CONFLICT:
    'O rascunho mudou. Preserve seu preenchimento, consulte a versão atual e revise novamente.',
  INVALID_STATE: 'Esta compra não permite a operação solicitada.',
  BELOW_COST: 'Operação incompatível com compras.',
  INSUFFICIENT_STOCK: 'Estoque insuficiente.',
  IDEMPOTENCY_CONFLICT:
    'Chave utilizada com outro conteúdo. Não substitua a chave de uma operação incerta.',
  BUSY: 'Banco ocupado. Repita o mesmo comando.',
  INTEGRITY: 'Falha de integridade. A operação foi desfeita e os dados preservados.',
  INTERNAL_ERROR: 'Não foi possível confirmar o resultado. Repita o mesmo comando.',
  IPC_UNAVAILABLE: 'Resposta não confirmada. Repita o mesmo comando antes de editar ou sair.',
  DESKTOP_UNAVAILABLE: 'Abra pelo aplicativo desktop.',
};
