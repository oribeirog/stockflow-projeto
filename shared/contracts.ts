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
  compras: ComprasApi;
  estoque: EstoqueApi;
  fotos: FotosApi;
  cadastros: CadastrosApi;
  system: { getStatus(): Promise<Result<SystemStatus>> };
}
