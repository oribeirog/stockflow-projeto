import type { ConsultaCadastro } from './catalogos';
import type {
  CodigoErroEstoque,
  ComandoEstoque,
  DadosContagem,
  MovimentacaoEstoque,
  ResultadoEstoque,
  SaldoEstoque,
} from './estoque';

export interface ConsultaEstoque extends ConsultaCadastro {
  somenteBaixo?: boolean;
}
export interface ProdutoEstoque extends SaldoEstoque {
  nome: string;
  sku: string;
  ativo: boolean;
  estoqueMinimo: number;
  baixo: boolean;
  // Display only, rounded by the main process. Never a cost basis.
  custoMedioDecimal: string | null;
}
export interface PaginaEstoque {
  itens: ProdutoEstoque[];
  temMais: boolean;
  valorTotalFiltradoCentavos: string;
}
export interface ConsultaMovimentacoes {
  produtoId: number;
  aposId?: number;
  limite?: number;
}
export interface MovimentoConsulta extends MovimentacaoEstoque {
  contagem: boolean;
}
export interface PaginaMovimentacoes {
  itens: MovimentoConsulta[];
  temMais: boolean;
  proximoId: number;
}
export interface DadosSaidaManual {
  produtoId: number;
  quantidade: number;
}
export interface DadosEntradaManual extends DadosSaidaManual {
  custoTotalCentavos: number;
}
export type AcaoEstoque = 'entrada' | 'saida' | 'perda' | 'contagem';
export type DadosOperacaoEstoque = DadosEntradaManual | DadosSaidaManual | DadosContagem;
export type CodigoErroDesktopEstoque =
  | CodigoErroEstoque
  | 'INTERNAL_ERROR'
  | 'DESKTOP_UNAVAILABLE'
  | 'IPC_UNAVAILABLE';
export type ResultadoDesktopEstoque<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CodigoErroDesktopEstoque; message: string } };
export interface EstoqueApi {
  listar(input: ConsultaEstoque): Promise<ResultadoDesktopEstoque<PaginaEstoque>>;
  obter(produtoId: number): Promise<ResultadoDesktopEstoque<ProdutoEstoque>>;
  listarMovimentacoes(
    input: ConsultaMovimentacoes,
  ): Promise<ResultadoDesktopEstoque<PaginaMovimentacoes>>;
  registrarEntrada(
    command: ComandoEstoque<DadosEntradaManual>,
  ): Promise<ResultadoDesktopEstoque<ResultadoEstoque>>;
  registrarSaida(
    command: ComandoEstoque<DadosSaidaManual>,
  ): Promise<ResultadoDesktopEstoque<ResultadoEstoque>>;
  registrarPerda(
    command: ComandoEstoque<DadosSaidaManual>,
  ): Promise<ResultadoDesktopEstoque<ResultadoEstoque>>;
  registrarContagem(
    command: ComandoEstoque<DadosContagem>,
  ): Promise<ResultadoDesktopEstoque<ResultadoEstoque>>;
}
export const CANAIS_ESTOQUE = {
  listar: 'estoque:listar',
  obter: 'estoque:obter',
  listarMovimentacoes: 'estoque:listar-movimentacoes',
  registrarEntrada: 'estoque:registrar-entrada',
  registrarSaida: 'estoque:registrar-saida',
  registrarPerda: 'estoque:registrar-perda',
  registrarContagem: 'estoque:registrar-contagem',
} as const;
export const MENSAGENS_ESTOQUE: Record<CodigoErroDesktopEstoque, string> = {
  VALIDATION: 'Confira os campos, a data efetiva e os limites informados.',
  NOT_FOUND: 'Produto ou saldo não encontrado.',
  INSUFFICIENT_STOCK: 'Estoque insuficiente. Consulte o saldo e revise a quantidade.',
  VERSION_CONFLICT:
    'O saldo mudou. Atualize a leitura e revise a contagem antes de confirmar novamente.',
  IDEMPOTENCY_CONFLICT: 'Esta chave já foi utilizada com outro conteúdo. A operação foi bloqueada.',
  BUSY: 'Banco ocupado. Aguarde e repita o mesmo comando.',
  INTEGRITY: 'Falha de integridade. Os dados foram preservados.',
  INTERNAL_ERROR: 'Não foi possível confirmar a operação. Repita o mesmo comando.',
  DESKTOP_UNAVAILABLE: 'Abra pelo aplicativo desktop.',
  IPC_UNAVAILABLE: 'Resposta não confirmada. Repita a operação com o mesmo comando.',
};
