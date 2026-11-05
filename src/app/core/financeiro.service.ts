import { Injectable, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import type { FinanceiroApi, ResultadoConsulta } from '../../../shared/financeiro-ipc';
import type { CorrecoesApi } from '../../../shared/correcoes-ipc';
import type { RevisaoRecebimento } from '../../../shared/financeiro-ipc';

export class IntencaoRecebimento {
  private readonly command: Parameters<FinanceiroApi['registrarRecebimento']>[0];
  private pending?: ReturnType<FinanceiroApi['registrarRecebimento']>;
  get operacaoId() {
    return this.command.operacaoId;
  }
  constructor(
    private readonly send: FinanceiroApi['registrarRecebimento'],
    revisao: RevisaoRecebimento,
  ) {
    this.command = structuredClone({
      operacaoId: crypto.randomUUID(),
      motivo: revisao.motivo,
      dados: revisao.dados,
      revisao: revisao.revisao,
    });
  }
  executar() {
    this.pending ??= this.send(structuredClone(this.command)).finally(
      () => (this.pending = undefined),
    );
    return this.pending;
  }
}

@Injectable({ providedIn: 'root' })
export class FinanceiroService {
  private readonly desktop = inject(DesktopService);
  novaIntencao(revisao: RevisaoRecebimento) {
    return new IntencaoRecebimento(async (command) => {
      const api = this.desktop.financialApi();
      if (!api)
        return {
          ok: false,
          error: { code: 'DESKTOP_UNAVAILABLE', message: 'Abra pelo aplicativo desktop.' },
        };
      try {
        return await api.registrarRecebimento(command);
      } catch {
        return {
          ok: false,
          error: {
            code: 'IPC_UNAVAILABLE',
            message: 'Resposta não confirmada. Repita o mesmo recebimento antes de editar ou sair.',
          },
        };
      }
    }, revisao);
  }
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
