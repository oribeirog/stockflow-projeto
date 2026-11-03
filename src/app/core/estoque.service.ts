import { Injectable, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import type { ComandoEstoque, ResultadoEstoque } from '../../../shared/estoque';
import {
  MENSAGENS_ESTOQUE,
  type AcaoEstoque,
  type ConsultaEstoque,
  type ConsultaMovimentacoes,
  type DadosOperacaoEstoque,
  type EstoqueApi,
  type ResultadoDesktopEstoque,
} from '../../../shared/estoque-ipc';

export class IntencaoEstoque {
  private readonly comando: ComandoEstoque<DadosOperacaoEstoque>;
  get operacaoId() {
    return this.comando.operacaoId;
  }
  private pending?: Promise<ResultadoDesktopEstoque<ResultadoEstoque>>;
  constructor(
    private readonly execute: (
      command: ComandoEstoque<DadosOperacaoEstoque>,
    ) => Promise<ResultadoDesktopEstoque<ResultadoEstoque>>,
    dados: DadosOperacaoEstoque,
    motivo: string,
    dataEfetiva: string,
  ) {
    this.comando = structuredClone({ operacaoId: crypto.randomUUID(), motivo, dataEfetiva, dados });
  }
  executar() {
    this.pending ??= this.execute(structuredClone(this.comando)).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
}
@Injectable({ providedIn: 'root' })
export class EstoqueService {
  private readonly desktop = inject(DesktopService);
  listar(input: ConsultaEstoque) {
    return this.call((api) => api.listar(input));
  }
  obter(id: number) {
    return this.call((api) => api.obter(id));
  }
  movimentos(input: ConsultaMovimentacoes) {
    return this.call((api) => api.listarMovimentacoes(input));
  }
  novaIntencao(acao: AcaoEstoque, dados: DadosOperacaoEstoque, motivo: string, date: string) {
    return new IntencaoEstoque(
      (command) =>
        this.call((api) => {
          switch (acao) {
            case 'entrada':
              return api.registrarEntrada(command as Parameters<EstoqueApi['registrarEntrada']>[0]);
            case 'saida':
              return api.registrarSaida(command as Parameters<EstoqueApi['registrarSaida']>[0]);
            case 'perda':
              return api.registrarPerda(command as Parameters<EstoqueApi['registrarPerda']>[0]);
            case 'contagem':
              return api.registrarContagem(
                command as Parameters<EstoqueApi['registrarContagem']>[0],
              );
          }
        }),
      dados,
      motivo,
      date,
    );
  }
  private async call<T>(
    operation: (api: EstoqueApi) => Promise<ResultadoDesktopEstoque<T>>,
  ): Promise<ResultadoDesktopEstoque<T>> {
    const api = this.desktop.stockApi();
    if (!api)
      return {
        ok: false,
        error: { code: 'DESKTOP_UNAVAILABLE', message: MENSAGENS_ESTOQUE.DESKTOP_UNAVAILABLE },
      };
    try {
      return await operation(api);
    } catch {
      return {
        ok: false,
        error: { code: 'IPC_UNAVAILABLE', message: MENSAGENS_ESTOQUE.IPC_UNAVAILABLE },
      };
    }
  }
}
