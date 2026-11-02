// Internal service DTOs only; no preload or IPC exposure.
export type NaturezaEstoque =
  | 'AJUSTE_ENTRADA'
  | 'AJUSTE_SAIDA'
  | 'PERDA'
  | 'COMPRA'
  | 'VENDA'
  | 'DEV_VENDA'
  | 'DEV_COMPRA'
  | 'REVERSAO_ENTRADA'
  | 'REVERSAO_SAIDA'
  | 'PERDA_DEVOLUCAO';
export type CodigoErroEstoque =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSY'
  | 'INTEGRITY';
export interface SaldoEstoque {
  produtoId: number;
  quantidade: number;
  valorTotalCentavos: number;
  versao: number;
}
export interface DadosMovimento {
  produtoId: number;
  quantidade: number;
  movimentacaoOrigemId?: number;
}
export interface DadosEntrada extends DadosMovimento {
  custoTotalCentavos: number;
}
export interface DadosContagem {
  produtoId: number;
  quantidadeContada: number;
  versaoEsperada: number;
  custoTotalCentavos?: number;
}
export interface ComandoEstoque<T> {
  operacaoId: string;
  motivo: string;
  dataEfetiva: string;
  dados: T;
}
export interface MovimentacaoEstoque {
  id: number;
  produtoId: number;
  natureza: NaturezaEstoque;
  quantidadeDelta: number;
  valorDeltaCentavos: number;
  quantidadeApos: number;
  valorAposCentavos: number;
  versaoApos: number;
  motivo: string;
  dataEfetiva: string;
  registradoEm: string;
  operacaoId: string;
  movimentacaoOrigemId: number | null;
}
export interface ResultadoEstoque {
  saldo: SaldoEstoque;
  movimentacaoId: number | null;
}
export interface DivergenciaEstoque {
  produtoId: number;
  movimentacaoId: number | null;
  campo: string;
  esperado: string;
  encontrado: string;
}
export interface ReconciliacaoEstoque {
  consistente: boolean;
  produtos: number;
  movimentacoes: number;
  divergencias: DivergenciaEstoque[];
}
