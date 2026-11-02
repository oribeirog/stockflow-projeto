// Internal main-process service contracts. No IPC exposure.
export interface PagamentoFinanceiro {
  formaPagamentoId: number;
  valorCentavos: number;
}
export interface AlocacaoParcela {
  parcelaId: number;
  valorCentavos: number;
}
export interface DadosRecebimento {
  vendaId: number;
  dataEfetiva: string;
  pagamentos: PagamentoFinanceiro[];
  alocacoes?: AlocacaoParcela[];
}
export interface DadosPagamentoReembolso {
  reembolsoId: number;
  dataEfetiva: string;
  pagamentos: PagamentoFinanceiro[];
}
export interface DadosEstornoFinanceiro {
  movimentoId: number;
  dataEfetiva: string;
}
export interface DadosDevolucao {
  documentoId: number;
  dataEfetiva: string;
  itens: { itemId: number; quantidade: number; quantidadePerda?: number }[];
  pagamentos?: PagamentoFinanceiro[];
}
export interface DadosCancelamento {
  documentoId: number;
  dataEfetiva: string;
}
export interface ResumoFinanceiro {
  vendaId: number;
  valorOriginalCentavos: number;
  devolucoesCancelamentosCentavos: number;
  valorComercialLiquidoCentavos: number;
  recebimentosEfetivosCentavos: number;
  estornosRecebimentoCentavos: number;
  abatimentosDividaCentavos: number;
  reembolsosPagosCentavos: number;
  estornosReembolsoCentavos: number;
  saldoReceberCentavos: number;
  reembolsosPendentesCentavos: number;
}
