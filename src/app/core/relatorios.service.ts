import { Injectable, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import type { RelatoriosApi } from '../../../shared/relatorios-ipc';
import type { Result } from '../../../shared/contracts';
@Injectable({ providedIn: 'root' })
export class RelatoriosService {
  listarMovimentacaoProdutos(i: Parameters<RelatoriosApi['listarMovimentacaoProdutos']>[0]) {
    return this.query((a) => a.listarMovimentacaoProdutos(i));
  }
  listarTotaisPorForma(i: Parameters<RelatoriosApi['listarTotaisPorForma']>[0]) {
    return this.query((a) => a.listarTotaisPorForma(i));
  }
  private readonly desktop = inject(DesktopService);
  private async query<T>(fn: (api: RelatoriosApi) => Promise<Result<T>>): Promise<Result<T>> {
    const api = this.desktop.reportsApi();
    if (!api)
      return {
        ok: false,
        error: { code: 'DESKTOP_UNAVAILABLE', message: 'Abra pelo aplicativo desktop.' },
      };
    try {
      return await fn(api);
    } catch {
      return {
        ok: false,
        error: { code: 'IPC_UNAVAILABLE', message: 'Não foi possível consultar. Tente novamente.' },
      };
    }
  }
  obterResumoGerencial(i: Parameters<RelatoriosApi['obterResumoGerencial']>[0]) {
    return this.query((a) => a.obterResumoGerencial(i));
  }
  obterSeriesVendas(i: Parameters<RelatoriosApi['obterSeriesVendas']>[0]) {
    return this.query((a) => a.obterSeriesVendas(i));
  }
  obterSeriesRecebimentos(i: Parameters<RelatoriosApi['obterSeriesRecebimentos']>[0]) {
    return this.query((a) => a.obterSeriesRecebimentos(i));
  }
  listarVendas(i: Parameters<RelatoriosApi['listarVendas']>[0]) {
    return this.query((a) => a.listarVendas(i));
  }
  listarProdutos(i: Parameters<RelatoriosApi['listarProdutos']>[0]) {
    return this.query((a) => a.listarProdutos(i));
  }
  listarClientes(i: Parameters<RelatoriosApi['listarClientes']>[0]) {
    return this.query((a) => a.listarClientes(i));
  }
  listarMovimentos(i: Parameters<RelatoriosApi['listarMovimentos']>[0]) {
    return this.query((a) => a.listarMovimentos(i));
  }
  listarContasReceber(i: Parameters<RelatoriosApi['listarContasReceber']>[0]) {
    return this.query((a) => a.listarContasReceber(i));
  }
  listarReembolsos(i: Parameters<RelatoriosApi['listarReembolsos']>[0]) {
    return this.query((a) => a.listarReembolsos(i));
  }
  obterResumoEstoque(i: Parameters<RelatoriosApi['obterResumoEstoque']>[0]) {
    return this.query((a) => a.obterResumoEstoque(i));
  }
  listarSaldos(i: Parameters<RelatoriosApi['listarSaldos']>[0]) {
    return this.query((a) => a.listarSaldos(i));
  }
}
