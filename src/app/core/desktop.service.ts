import { Injectable } from '@angular/core';
import type { DesktopApi } from '../../../shared/contracts';
import type { FotosApi } from '../../../shared/fotos';
import {
  MENSAGENS_CADASTRO,
  type ResultadoCadastro,
  type CadastrosApi,
} from '../../../shared/cadastros-ipc';
declare global {
  interface Window {
    mnrApi?: DesktopApi;
  }
}
@Injectable({ providedIn: 'root' })
export class DesktopService {
  async foto<T>(
    operation: (api: FotosApi) => Promise<ResultadoCadastro<T>>,
  ): Promise<ResultadoCadastro<T>> {
    const api = this.getApi();
    if (!api)
      return {
        ok: false,
        error: { code: 'DESKTOP_UNAVAILABLE', message: MENSAGENS_CADASTRO.DESKTOP_UNAVAILABLE },
      };
    try {
      return await operation(api.fotos);
    } catch {
      return {
        ok: false,
        error: { code: 'IPC_UNAVAILABLE', message: MENSAGENS_CADASTRO.IPC_UNAVAILABLE },
      };
    }
  }
  protected getApi(): DesktopApi | undefined {
    return window.mnrApi;
  }
  async cadastro<T>(
    operation: (api: CadastrosApi) => Promise<ResultadoCadastro<T>>,
  ): Promise<ResultadoCadastro<T>> {
    const api = this.getApi();
    if (!api)
      return {
        ok: false,
        error: { code: 'DESKTOP_UNAVAILABLE', message: MENSAGENS_CADASTRO.DESKTOP_UNAVAILABLE },
      };
    try {
      return await operation(api.cadastros);
    } catch {
      return {
        ok: false,
        error: { code: 'IPC_UNAVAILABLE', message: MENSAGENS_CADASTRO.IPC_UNAVAILABLE },
      };
    }
  }
  status() {
    if (!window.mnrApi) return Promise.reject(new Error('Abra pelo aplicativo desktop.'));
    return window.mnrApi.system.getStatus();
  }
}
