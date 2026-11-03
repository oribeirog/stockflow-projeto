import { Injectable, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import type { FinanceiroApi, ResultadoConsulta } from '../../../shared/financeiro-ipc';
import type { CorrecoesApi } from '../../../shared/correcoes-ipc';

@Injectable({ providedIn: 'root' })
export class FinanceiroService {
  private readonly desktop = inject(DesktopService);
  async financeiro<T>(
    operation: (api: FinanceiroApi) => Promise<ResultadoConsulta<T>>,
  ): Promise<ResultadoConsulta<T>> {
    const api = this.desktop.financialApi();
    if (!api)
      return {
        ok: false,
        error: { code: 'DESKTOP_UNAVAILABLE', message: 'Abra pelo aplicativo desktop.' },
      };
    try {
      return await operation(api);
    } catch {
      return {
        ok: false,
        error: { code: 'IPC_UNAVAILABLE', message: 'Não foi possível consultar. Tente novamente.' },
      };
    }
  }
  async correcoes<T>(
    operation: (api: CorrecoesApi) => Promise<ResultadoConsulta<T>>,
  ): Promise<ResultadoConsulta<T>> {
    const api = this.desktop.correctionsApi();
    if (!api)
      return {
        ok: false,
        error: { code: 'DESKTOP_UNAVAILABLE', message: 'Abra pelo aplicativo desktop.' },
      };
    try {
      return await operation(api);
    } catch {
      return {
        ok: false,
        error: { code: 'IPC_UNAVAILABLE', message: 'Não foi possível consultar. Tente novamente.' },
      };
    }
  }
}
