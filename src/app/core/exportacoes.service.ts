import { Injectable, inject, signal } from '@angular/core';
import { DesktopService } from './desktop.service';
import type { PedidoExportacao, ResultadoExportacao } from '../../../shared/exportacoes';
import type { Result } from '../../../shared/contracts';
@Injectable({ providedIn: 'root' })
export class ExportacoesService {
  private readonly desktop = inject(DesktopService);
  readonly busy = signal(false);
  async exportar(
    pedido: PedidoExportacao,
    formato: 'xlsx' | 'pdf',
  ): Promise<Result<ResultadoExportacao>> {
    if (this.busy())
      return {
        ok: false,
        error: { code: 'EXPORT_BUSY', message: 'Uma exportação já está em andamento.' },
      };
    const api = this.desktop.exportsApi();
    if (!api)
      return {
        ok: false,
        error: {
          code: 'DESKTOP_UNAVAILABLE',
          message: 'Abra pelo aplicativo desktop para salvar o arquivo.',
        },
      };
    this.busy.set(true);
    try {
      return await (formato === 'xlsx' ? api.exportarExcel(pedido) : api.exportarPdf(pedido));
    } catch {
      return {
        ok: false,
        error: {
          code: 'IPC_UNAVAILABLE',
          message:
            'Não foi possível confirmar a exportação. Confira o destino escolhido antes de tentar novamente com outro nome.',
        },
      };
    } finally {
      this.busy.set(false);
    }
  }
}
