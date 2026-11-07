import type { Result } from './contracts';
export interface PeriodoRelatorio {
  dataInicio: string;
  dataFim: string;
}
export interface FiltroComercial extends PeriodoRelatorio {
  clienteId?: number;
  produtoId?: number;
}
export interface FiltroFinanceiro extends PeriodoRelatorio {
  clienteId?: number;
  formaPagamentoId?: number;
}
export interface PaginacaoRelatorio {
  limite?: number;
  deslocamento?: number;
}
export interface ConsultaVendasRelatorio extends FiltroComercial, PaginacaoRelatorio {
  ordem?: 'DATA_DESC' | 'VALOR_DESC';
}
export interface ConsultaRankingProdutos extends FiltroComercial, PaginacaoRelatorio {
  ordem?: 'UNIDADES_DESC' | 'VALOR_DESC';
}
export interface ConsultaClientesRelatorio extends PeriodoRelatorio, PaginacaoRelatorio {
  clienteId?: number;
}
export interface ConsultaMovimentosRelatorio extends FiltroFinanceiro, PaginacaoRelatorio {
  natureza?: 'RECEBIMENTO' | 'ESTORNO_RECEBIMENTO' | 'PAGAMENTO_REEMBOLSO' | 'ESTORNO_REEMBOLSO';
  ordem?: 'DATA_DESC' | 'VALOR_DESC';
}
export interface ConsultaContasRelatorio extends PaginacaoRelatorio {
  clienteId?: number;
  vendaId?: number;
  vencimentoDe?: string;
  vencimentoAte?: string;
  situacao?: 'TODAS' | 'ABERTAS' | 'VENCIDAS' | 'A_VENCER' | 'QUITADAS';
}
export interface ConsultaReembolsosRelatorio extends PaginacaoRelatorio {
  clienteId?: number;
  vendaId?: number;
  situacao?: 'TODAS' | 'PENDENTES' | 'QUITADAS' | 'ANULADAS';
}
export interface ConsultaEstoqueRelatorio extends PaginacaoRelatorio {
  produtoId?: number;
  ativo?: boolean;
  situacao?: 'TODOS' | 'SEM_ESTOQUE' | 'BAIXO';
  ordem?: 'ID' | 'QUANTIDADE_DESC' | 'VALOR_DESC';
}
export interface FluxoComercial {
  vendasConfirmadas: number;
  brutoVendasCentavos: number;
  vendasAposDescontosCentavos: number;
  devolucoesRegistradasCentavos: number;
  cancelamentosCentavos: number;
  estornosDevolucaoCentavos: number;
  devolucoesEfetivasCentavos: number;
  faturamentoLiquidoCentavos: number;
  unidadesVendidas: number;
  unidadesDevolvidas: number;
  unidadesDevolvidasEfetivas: number;
  unidadesCanceladas: number;
  unidadesEstornoDevolucao: number;
  unidadesLiquidas: number;
  cmvHistoricoLiquidoCentavos: number;
  perdasImpropriosLiquidasCentavos: number;
  resultadoBrutoEstimadoCentavos: number;
  margemBrutaPontosBase: number | null;
}
export interface FluxoFinanceiro {
  recebimentosBrutosCentavos: number;
  estornosRecebimentosCentavos: number;
  recebidoLiquidoCentavos: number;
  pagamentosReembolsoCentavos: number;
  estornosReembolsoCentavos: number;
  reembolsoPagoLiquidoCentavos: number;
}
export interface PosicaoContas {
  exigivelCentavos: number;
  vencidoCentavos: number;
  aVencerCentavos: number;
  parcelasAbertas: number;
  parcelasVencidas: number;
  parcelasQuitadas: number;
}
export interface PosicaoReembolsos {
  obrigacoesAtivas: number;
  obrigacoesPendentes: number;
  obrigacoesQuitadas: number;
  valorOriginalAtivoCentavos: number;
  pagoLiquidoAtivoCentavos: number;
  pendenteCentavos: number;
}
export interface ReferenciaRelatorio {
  dataReferencia: string;
  consultadoEm: string;
}
export interface ResumoGerencial extends ReferenciaRelatorio {
  periodo: PeriodoRelatorio;
  fluxoComercial: FluxoComercial;
  fluxoFinanceiro: FluxoFinanceiro;
  posicaoAtual: { contas: PosicaoContas; reembolsos: PosicaoReembolsos };
  coorteVendas: {
    comercialLiquidoAtualCentavos: number;
    vendasComValorPositivo: number;
    ticketMedioCentavos: number | null;
  };
}
export interface VendaRelatorio {
  vendaId: number;
  numero: string;
  dataComercial: string;
  clienteId: number | null;
  clienteNomeHistorico: string | null;
  estado: 'CONFIRMADO' | 'ESTORNADO';
  originalCentavos: number;
  comercialLiquidoAtualCentavos: number;
  custoHistoricoLiquidoAtualCentavos: number;
}
export interface ProdutoRanking {
  produtoId: number;
  skuHistorico: string;
  nomeHistorico: string;
  unidadesLiquidas: number;
  comercialLiquidoCentavos: number;
}
export interface ClienteRanking {
  clienteId: number | null;
  nomeHistorico: string | null;
  comercialLiquidoAtualCentavos: number;
  vendas: number;
}
export interface MovimentoRelatorio {
  id: number;
  vendaId: number;
  vendaNumero: string;
  clienteId: number | null;
  clienteNomeHistorico: string | null;
  natureza: NonNullable<ConsultaMovimentosRelatorio['natureza']>;
  formaPagamentoId: number;
  formaHistorica: string;
  valorCentavos: number;
  dataEfetiva: string;
  registradoEm: string;
  estornaMovimentoId: number | null;
}
export interface ContaRelatorio {
  id: number;
  vendaId: number;
  vendaNumero: string;
  clienteId: number | null;
  clienteNomeHistorico: string | null;
  tipo: 'REGULAR' | 'ENTRADA';
  vencimento: string;
  originalCentavos: number;
  recebimentosLiquidosCentavos: number;
  abatimentosLiquidosCentavos: number;
  saldoCentavos: number;
  status: 'PENDENTE' | 'PARCIALMENTE_PAGO' | 'QUITADO' | 'VENCIDO';
}
export interface ReembolsoRelatorio {
  id: number;
  vendaId: number;
  correcaoId: number;
  clienteId: number | null;
  clienteNomeHistorico: string | null;
  ativa: boolean;
  originalCentavos: number;
  pagoLiquidoCentavos: number;
  pendenteCentavos: number;
}
export interface SaldoProdutoRelatorio {
  produtoId: number;
  nomeAtual: string;
  skuAtual: string;
  ativo: boolean;
  estoqueMinimo: number;
  quantidade: number;
  valorCentavos: number;
}
export interface TotaisVendas {
  vendas: number;
  originalCentavos: number;
  comercialLiquidoAtualCentavos: number;
  custoHistoricoLiquidoAtualCentavos: number;
}
export interface PosicaoEstoque {
  produtos: number;
  unidades: number;
  valorCentavos: number;
  semEstoque: number;
  abaixoMinimo: number;
}
export interface PaginaRelatorio<T, S> extends ReferenciaRelatorio {
  itens: T[];
  totais: S;
  temMais: boolean;
}
export interface SerieRelatorio<T> extends ReferenciaRelatorio {
  periodo: PeriodoRelatorio;
  agrupamento: 'DIARIO' | 'MENSAL';
  itens: ({ competencia: string } & T)[];
}
export interface ResumoEstoqueRelatorio extends ReferenciaRelatorio {
  posicaoAtual: PosicaoEstoque;
  periodo: PeriodoRelatorio;
  movimentosPeriodo: {
    natureza: string;
    movimentos: number;
    quantidadeDelta: number;
    valorDeltaCentavos: number;
  }[];
}
export const CANAIS_RELATORIOS = {
  listarMovimentacaoProdutos: 'relatorios:listar-movimentacao-produtos',
  listarTotaisPorForma: 'relatorios:listar-totais-por-forma',
  obterResumoGerencial: 'relatorios:obter-resumo-gerencial',
  obterSeriesVendas: 'relatorios:obter-series-vendas',
  obterSeriesRecebimentos: 'relatorios:obter-series-recebimentos',
  listarVendas: 'relatorios:listar-vendas',
  listarProdutos: 'relatorios:listar-produtos',
  listarClientes: 'relatorios:listar-clientes',
  listarMovimentos: 'relatorios:listar-movimentos',
  listarContasReceber: 'relatorios:listar-contas-receber',
  listarReembolsos: 'relatorios:listar-reembolsos',
  obterResumoEstoque: 'relatorios:obter-resumo-estoque',
  listarSaldos: 'relatorios:listar-saldos',
} as const;
export interface RelatoriosApi {
  listarMovimentacaoProdutos(
    i: PeriodoRelatorio & PaginacaoRelatorio & { produtoId?: number },
  ): Promise<
    Result<
      PaginaRelatorio<
        {
          produtoId: number;
          nomeAtual: string;
          skuAtual: string;
          movimentos: number;
          unidadesMovimentadas: number;
        },
        { produtos: number; movimentos: number; unidadesMovimentadas: number }
      >
    >
  >;
  listarTotaisPorForma(
    i: FiltroFinanceiro & PaginacaoRelatorio,
  ): Promise<
    Result<
      PaginaRelatorio<
        FluxoFinanceiro & { formaPagamentoId: number; formaHistorica: string },
        FluxoFinanceiro
      >
    >
  >;
  obterResumoGerencial(
    i: PeriodoRelatorio & { clienteId?: number },
  ): Promise<Result<ResumoGerencial>>;
  obterSeriesVendas(
    i: FiltroComercial & { agrupamento: 'DIARIO' | 'MENSAL' },
  ): Promise<Result<SerieRelatorio<FluxoComercial>>>;
  obterSeriesRecebimentos(
    i: FiltroFinanceiro & { agrupamento: 'DIARIO' | 'MENSAL' },
  ): Promise<Result<SerieRelatorio<FluxoFinanceiro>>>;
  listarVendas(
    i: ConsultaVendasRelatorio,
  ): Promise<Result<PaginaRelatorio<VendaRelatorio, TotaisVendas>>>;
  listarProdutos(
    i: ConsultaRankingProdutos,
  ): Promise<
    Result<
      PaginaRelatorio<
        ProdutoRanking,
        { produtos: number; unidadesLiquidas: number; comercialLiquidoCentavos: number }
      >
    >
  >;
  listarClientes(
    i: ConsultaClientesRelatorio,
  ): Promise<
    Result<
      PaginaRelatorio<ClienteRanking, { clientes: number; comercialLiquidoAtualCentavos: number }>
    >
  >;
  listarMovimentos(
    i: ConsultaMovimentosRelatorio,
  ): Promise<Result<PaginaRelatorio<MovimentoRelatorio, FluxoFinanceiro>>>;
  listarContasReceber(
    i: ConsultaContasRelatorio,
  ): Promise<Result<PaginaRelatorio<ContaRelatorio, PosicaoContas>>>;
  listarReembolsos(
    i: ConsultaReembolsosRelatorio,
  ): Promise<Result<PaginaRelatorio<ReembolsoRelatorio, PosicaoReembolsos>>>;
  obterResumoEstoque(
    i: PeriodoRelatorio & { produtoId?: number },
  ): Promise<Result<ResumoEstoqueRelatorio>>;
  listarSaldos(
    i: ConsultaEstoqueRelatorio,
  ): Promise<Result<PaginaRelatorio<SaldoProdutoRelatorio, PosicaoEstoque>>>;
}
