import { Injectable, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import {
  MENSAGENS_COMPRAS,
  type ComprasApi,
  type ResultadoCompra,
  type ConsultaCompras,
} from '../../../shared/compras-ipc';
import type { ComandoComercial } from '../../../shared/comercial';

export class IntencaoCompra<T> {
  private readonly original: ComandoComercial<T>;
  private pending?: Promise<ResultadoCompra<import('../../../shared/compras-ipc').Compra>>;
  get operacaoId() {
    return this.original.operacaoId;
  }
  constructor(
    private readonly send: (
      command: ComandoComercial<T>,
    ) => Promise<ResultadoCompra<import('../../../shared/compras-ipc').Compra>>,
    dados: T,
    motivo: string,
  ) {
    this.original = structuredClone({ operacaoId: crypto.randomUUID(), motivo, dados });
  }
  executar() {
    this.pending ??= this.send(structuredClone(this.original)).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
}
@Injectable({ providedIn: 'root' })
export class ComprasService {
  private readonly desktop = inject(DesktopService);
  listar(input: ConsultaCompras) {
    return this.call((api) => api.listar(input));
  }
  obter(id: number) {
    return this.call((api) => api.obter(id));
  }
  intencao<K extends 'salvarRascunho' | 'confirmar' | 'descartarRascunho'>(
    method: K,
    dados: Parameters<ComprasApi[K]>[0]['dados'],
    motivo: string,
  ) {
    return new IntencaoCompra(
      (command) =>
        this.call((api) =>
          (api[method] as (c: typeof command) => ReturnType<ComprasApi[K]>)(command),
        ),
      dados,
      motivo,
    );
  }
  private async call<T>(
    operation: (api: ComprasApi) => Promise<ResultadoCompra<T>>,
  ): Promise<ResultadoCompra<T>> {
    const api = this.desktop.purchaseApi();
    if (!api)
      return {
        ok: false,
        error: { code: 'DESKTOP_UNAVAILABLE', message: MENSAGENS_COMPRAS.DESKTOP_UNAVAILABLE },
      };
    try {
      return await operation(api);
    } catch {
      return {
        ok: false,
        error: { code: 'IPC_UNAVAILABLE', message: MENSAGENS_COMPRAS.IPC_UNAVAILABLE },
      };
    }
  }
}
