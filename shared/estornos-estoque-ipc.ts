import type { ProdutoEstoque } from './estoque-ipc';
import type { ResultadoEstoque } from './estoque';
import type { ResultadoCompra } from './compras-ipc';
export interface ReferenciaAjuste {
  produtoId: number;
  movimentoId: number;
}
export interface DadosEstornoAjuste extends ReferenciaAjuste {
  dataEfetiva: string;
}
export interface MovimentoAjuste {
  id: number;
  natureza: string;
  quantidadeDelta: number;
  valorDeltaCentavos: number;
  quantidadeApos: number;
  valorAposCentavos: number;
  dataEfetiva: string;
  registradoEm: string;
  motivo: string;
  origemId: number | null;
  contagem: boolean;
}
export interface DetalheAjuste {
  produto: ProdutoEstoque;
  original: MovimentoAjuste;
  estorno: MovimentoAjuste | null;
  elegivel: boolean;
  impedimento: string | null;
  posteriores: MovimentoAjuste[];
  temMaisPosteriores: boolean;
}
export interface RevisaoEstornoAjuste {
  dados: DadosEstornoAjuste;
  motivo: string;
  revisao: string;
  contexto: DetalheAjuste;
  quantidadeDelta: number;
  valorDeltaCentavos: number;
  quantidadeAntes: number;
  valorAntesCentavos: number;
  quantidadeApos: number;
  valorAposCentavos: number;
  versao: number;
}
export interface EstornosEstoqueApi {
  obterAjuste(input: ReferenciaAjuste): Promise<ResultadoCompra<DetalheAjuste>>;
  revisarEstorno(input: {
    dados: DadosEstornoAjuste;
    motivo: string;
  }): Promise<ResultadoCompra<RevisaoEstornoAjuste>>;
  estornar(input: {
    operacaoId: string;
    dados: DadosEstornoAjuste;
    motivo: string;
    revisao: string;
  }): Promise<ResultadoCompra<ResultadoEstoque>>;
}
export const CANAIS_ESTORNOS_ESTOQUE = {
  obterAjuste: 'estornos-estoque:obter-ajuste',
  revisarEstorno: 'estornos-estoque:revisar',
  estornar: 'estornos-estoque:estornar',
} as const;
