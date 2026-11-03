import type { CadastrosApi } from './cadastros-ipc';
import type { FotosApi } from './fotos';
import type { EstoqueApi } from './estoque-ipc';
export const STATUS_CHANNEL = 'system:get-status';
export interface SystemStatus {
  database: 'ready';
  version: string;
}
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
export interface DesktopApi {
  estoque: EstoqueApi;
  fotos: FotosApi;
  cadastros: CadastrosApi;
  system: { getStatus(): Promise<Result<SystemStatus>> };
}
