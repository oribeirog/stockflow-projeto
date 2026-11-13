import { Injectable, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import type {
  EstornosEstoqueApi,
  RevisaoEstornoAjuste,
} from '../../../shared/estornos-estoque-ipc';
import type { ResultadoCompra } from '../../../shared/compras-ipc';
import type { ResultadoEstoque } from '../../../shared/estoque';
@Injectable({ providedIn: 'root' })
export class EstornosEstoqueService {
  private readonly desktop = inject(DesktopService);
  async consultar<T>(
    operation: (api: EstornosEstoqueApi) => Promise<ResultadoCompra<T>>,
  ): Promise<ResultadoCompra<T>> {
    const api = this.desktop.stockReversalsApi();
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
            'Resposta não confirmada. Se houve confirmação, repita a mesma intenção antes de editar ou sair.',
        },
      };
    }
  }
  novaIntencao(r: RevisaoEstornoAjuste) {
    const command = structuredClone({
      operacaoId: crypto.randomUUID(),
      dados: r.dados,
      motivo: r.motivo,
      revisao: r.revisao,
    });
    let pending: Promise<ResultadoCompra<ResultadoEstoque>> | undefined;
    return {
      executar: () =>
        (pending ??= this.consultar((api) => api.estornar(structuredClone(command))).finally(
          () => (pending = undefined),
        )),
    };
  }
}
