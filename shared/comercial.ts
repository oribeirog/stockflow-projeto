// Internal service contracts only. No preload/IPC exposure.
export type TipoDocumento = 'COMPRA' | 'VENDA' | 'DEV_COMPRA' | 'DEV_VENDA' | 'ESTORNO';
export type EstadoDocumento = 'RASCUNHO' | 'CONFIRMADO' | 'DESCARTADO' | 'ESTORNADO';
export type ModalidadeVenda = 'A_VISTA' | 'A_PRAZO';
export type Desconto = { tipo: 'CENTAVOS' | 'PONTOS_BASE'; valor: number };
export interface ItemRascunho {
  produtoId: number;
  quantidade: number;
  valorUnitarioCentavos: number;
  desconto?: Desconto;
  motivo?: string | null;
}
export interface DadosRascunho {
  id?: number;
  versaoEsperada?: number;
  tipo: 'COMPRA' | 'VENDA';
  clienteId?: number | null;
  fornecedorId?: number | null;
  modalidadeVenda?: ModalidadeVenda | null;
  dataComercial: string;
  itens: ItemRascunho[];
  descontoGlobal?: Desconto;
  freteCentavos?: number;
  despesasDiretasCentavos?: number;
  observacoes?: string | null;
}
export interface PagamentoConfirmacao {
  formaPagamentoId: number;
  valorCentavos: number;
}
export interface ParcelaPlanejada {
  valorCentavos: number;
  vencimento: string;
}
export interface DadosConfirmacao {
  id: number;
  versaoEsperada: number;
  pagamentos?: PagamentoConfirmacao[];
  parcelas?: ParcelaPlanejada[];
}
export interface ComandoComercial<T> {
  operacaoId: string;
  motivo: string;
  dados: T;
}
export interface ItemComercial {
  id: number;
  sequencia: number;
  produtoId: number;
  skuHistorico: string | null;
  descricaoHistorica: string | null;
  quantidade: number;
  valorUnitarioCentavos: number;
  valorBrutoCentavos: number;
  descontoItemCentavos: number;
  descontoGlobalRateadoCentavos: number;
  freteRateadoCentavos: number;
  despesasRateadasCentavos: number;
  valorLiquidoCentavos: number;
  valorCustoEstoqueCentavos: number;
  motivo: string | null;
}
export interface ParcelaReceber {
  id: number;
  numero: number;
  valorOriginalCentavos: number;
  vencimento: string;
}
export interface DocumentoComercial {
  id: number;
  numero: string;
  tipo: TipoDocumento;
  estado: EstadoDocumento;
  versao: number;
  clienteId: number | null;
  fornecedorId: number | null;
  contraparteNome: string | null;
  contraparteDocumento: string | null;
  modalidadeVenda: ModalidadeVenda | null;
  dataComercial: string;
  subtotalCentavos: number;
  descontoItensCentavos: number;
  descontoGlobalCentavos: number;
  freteCentavos: number;
  despesasDiretasCentavos: number;
  totalCentavos: number;
  observacoes: string | null;
  criadoEm: string;
  confirmadoEm: string | null;
  operacaoConfirmacaoId: string | null;
  itens: ItemComercial[];
  parcelas: ParcelaReceber[];
  recebimentosEfetivosCentavos: number;
  saldoReceberCentavos: number;
}
export type CodigoErroComercial =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'INACTIVE_REFERENCE'
  | 'VERSION_CONFLICT'
  | 'INVALID_STATE'
  | 'BELOW_COST'
  | 'INSUFFICIENT_STOCK'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSY'
  | 'INTEGRITY';
