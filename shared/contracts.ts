import type { VendasApi } from './vendas-ipc';
import type { ExportacoesApi } from './exportacoes';
import type { RelatoriosApi } from './relatorios-ipc';
import type { FinanceiroApi } from './financeiro-ipc';
import type { CorrecoesApi } from './correcoes-ipc';
import type { CadastrosApi } from './cadastros-ipc';
import type { FotosApi } from './fotos';
import type { EstoqueApi } from './estoque-ipc';
import type { ComprasApi } from './compras-ipc';
export const STATUS_CHANNEL = 'system:get-status';
export interface SystemStatus {
  database: 'ready';
  version: string;
}
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
export interface DesktopApi {
  exportacoes: ExportacoesApi;
  relatorios: RelatoriosApi;
  financeiro: FinanceiroApi;
  correcoes: CorrecoesApi;
  compras: ComprasApi;
  vendas: VendasApi;
  estoque: EstoqueApi;
  fotos: FotosApi;
  cadastros: CadastrosApi;
  system: { getStatus(): Promise<Result<SystemStatus>> };
}
