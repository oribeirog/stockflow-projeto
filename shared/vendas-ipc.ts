import type {
  ComandoComercial,
  DadosRascunho,
  DocumentoComercial,
  DadosConfirmacao,
  EstadoDocumento,
} from './comercial';
import type { ResumoFinanceiro } from './financeiro';
import type { ResultadoCompra } from './compras-ipc';

export type DadosRascunhoVenda = Omit<
  DadosRascunho,
  'tipo' | 'fornecedorId' | 'freteCentavos' | 'despesasDiretasCentavos'
>;
export interface PlanoVenda extends DadosConfirmacao {
  comEntrada: boolean;
}
export interface RevisaoVenda {
  avisos: string[];
  plano: PlanoVenda;
  revisao: string;
  totalCentavos: number;
  recebidoConfirmacaoCentavos: number;
  saldoFuturoCentavos: number;
}
export interface ConsultaVendas {
  estado?: EstadoDocumento;
  clienteId?: number;
  limite?: number;
  deslocamento?: number;
}
export interface PagamentoVenda {
  id: number;
  formaPagamentoId: number;
  nomeHistorico: string;
  valorCentavos: number;
  dataEfetiva: string;
  registradoEm: string;
}
export interface ParcelaVenda {
  id: number;
  numero: number;
  valorOriginalCentavos: number;
  vencimento: string;
  tipo: 'ENTRADA' | 'REGULAR';
  recebimentosCentavos: number;
  abatimentosCentavos: number;
  saldoCentavos: number;
  status: string;
}
export interface Venda extends DocumentoComercial {
  financeiro: ResumoFinanceiro | null;
  pagamentos: PagamentoVenda[];
  parcelasFinanceiras: ParcelaVenda[];
  recebidoConfirmacaoCentavos: number;
}
export interface PaginaVendas {
  itens: Pick<
    Venda,
    | 'id'
    | 'numero'
    | 'estado'
    | 'clienteId'
    | 'contraparteNome'
    | 'modalidadeVenda'
    | 'dataComercial'
    | 'totalCentavos'
  >[];
  temMais: boolean;
}
export type ResultadoVenda<T> = ResultadoCompra<T>;
export interface VendasApi {
  listar(input: ConsultaVendas): Promise<ResultadoVenda<PaginaVendas>>;
  obter(id: number): Promise<ResultadoVenda<Venda>>;
  salvarRascunho(command: ComandoComercial<DadosRascunhoVenda>): Promise<ResultadoVenda<Venda>>;
  revisarPlano(
    input: PlanoVenda & { dividir?: { vencimentos: string[] } },
  ): Promise<ResultadoVenda<RevisaoVenda>>;
  confirmar(
    command: ComandoComercial<DadosConfirmacao & { revisao: string }>,
  ): Promise<ResultadoVenda<Venda>>;
  confirmarComEntrada(
    command: ComandoComercial<DadosConfirmacao & { revisao: string }>,
  ): Promise<ResultadoVenda<Venda>>;
  descartarRascunho(
    command: ComandoComercial<{ id: number; versaoEsperada: number }>,
  ): Promise<ResultadoVenda<Venda>>;
}
export const CANAIS_VENDAS = {
  listar: 'vendas:listar',
  obter: 'vendas:obter',
  salvarRascunho: 'vendas:salvar-rascunho',
  revisarPlano: 'vendas:revisar-plano',
  confirmar: 'vendas:confirmar',
  confirmarComEntrada: 'vendas:confirmar-com-entrada',
  descartarRascunho: 'vendas:descartar-rascunho',
} as const;
