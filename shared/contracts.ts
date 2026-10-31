export const STATUS_CHANNEL = 'system:get-status';
export interface SystemStatus {
  database: 'ready';
  version: string;
}
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
export interface DesktopApi {
  system: { getStatus(): Promise<Result<SystemStatus>> };
}
