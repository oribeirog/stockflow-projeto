import { Injectable, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import type {
  CorrecoesComprasApi,
  DadosDevolucaoCompra,
  RevisaoCorrecaoCompra,
} from '../../../shared/correcoes-compras-ipc';
import type { ResultadoCompra } from '../../../shared/compras-ipc';
import type { ResultadoCorrecao, ComandoCorrecao } from '../../../shared/correcoes-ipc';
@Injectable({ providedIn: 'root' })
export class CorrecoesComprasService {
  private readonly desktop = inject(DesktopService);
  async consultar<T>(
    operation: (api: CorrecoesComprasApi) => Promise<ResultadoCompra<T>>,
  ): Promise<ResultadoCompra<T>> {
    const api = this.desktop.purchaseCorrectionsApi();
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
        error: {
          code: 'IPC_UNAVAILABLE',
          message:
            'Resposta não confirmada. Consulte novamente; se houve confirmação, repita a mesma intenção antes de editar ou sair.',
        },
      };
    }
  }
  novaIntencao(review: RevisaoCorrecaoCompra) {
    const command = structuredClone({
        operacaoId: crypto.randomUUID(),
        motivo: review.motivo,
        dados: review.dados,
        revisao: review.revisao,
      }),
      cancel = review.cancelamento;
    let pending: Promise<ResultadoCompra<ResultadoCorrecao>> | undefined;
    return {
      operacaoId: command.operacaoId,
      executar: () =>
        (pending ??= this.consultar((api) =>
          cancel
            ? api.cancelar(structuredClone(command))
            : api.devolver(structuredClone(command) as ComandoCorrecao<DadosDevolucaoCompra>),
        ).finally(() => (pending = undefined))),
    };
  }
}
