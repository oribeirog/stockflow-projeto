import { Injectable, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import {
  type VendasApi,
  type ResultadoVenda,
  type ConsultaVendas,
} from '../../../shared/vendas-ipc';
import { MENSAGENS_COMPRAS } from '../../../shared/compras-ipc';
import type { ComandoComercial } from '../../../shared/comercial';

export class IntencaoVenda<T> {
  private readonly original: ComandoComercial<T>;
  private pending?: Promise<ResultadoVenda<import('../../../shared/vendas-ipc').Venda>>;
  get operacaoId() {
    return this.original.operacaoId;
  }
  constructor(
    private readonly send: (
      command: ComandoComercial<T>,
    ) => Promise<ResultadoVenda<import('../../../shared/vendas-ipc').Venda>>,
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
export class VendasService {
  private readonly desktop = inject(DesktopService);
  listar(input: ConsultaVendas) {
    return this.call((api) => api.listar(input));
  }
  obter(id: number) {
    return this.call((api) => api.obter(id));
  }
  revisarPlano(input: Parameters<VendasApi['revisarPlano']>[0]) {
    return this.call((api) => api.revisarPlano(input));
  }
  intencao<K extends 'salvarRascunho' | 'confirmar' | 'confirmarComEntrada' | 'descartarRascunho'>(
    method: K,
    dados: Parameters<VendasApi[K]>[0]['dados'],
    motivo: string,
  ) {
    return new IntencaoVenda(
      (command) =>
        this.call((api) =>
          (api[method] as (c: typeof command) => ReturnType<VendasApi[K]>)(command),
        ),
      dados,
      motivo,
    );
  }
  private async call<T>(
    operation: (api: VendasApi) => Promise<ResultadoVenda<T>>,
  ): Promise<ResultadoVenda<T>> {
    const api = this.desktop.salesApi();
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
