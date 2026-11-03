import { Injectable, inject } from '@angular/core';
import type { ComandoCadastro } from '../../../../shared/catalogos';
import type { EntradaFoto, ImagemFoto, VinculoFoto } from '../../../../shared/fotos';
import type { ResultadoCadastro } from '../../../../shared/cadastros-ipc';
import { DesktopService } from '../desktop.service';
import { GravacaoEstado } from './estado';
@Injectable({ providedIn: 'root' })
export class FotosService {
  private readonly desktop = inject(DesktopService);
  private readonly reads = new Map<string, Promise<ResultadoCadastro<ImagemFoto | null>>>();
  selecionar() {
    return this.desktop.foto((api) => api.selecionar());
  }
  descartar(token: string) {
    return this.desktop.foto((api) => api.descartar(token));
  }
  obter(produtoId: number, variante: 'imagem' | 'miniatura') {
    const key = produtoId + variante;
    const existing = this.reads.get(key);
    if (existing) return existing;
    const pending = this.desktop
      .foto((api) => api.obter({ produtoId, variante }))
      .finally(() => {
        if (this.reads.get(key) === pending) this.reads.delete(key);
      });
    this.reads.set(key, pending);
    return pending;
  }
  novaGravacao(dados: EntradaFoto, motivo: string) {
    return new GravacaoEstado<VinculoFoto, EntradaFoto>(
      async (command) => {
        const result = await this.desktop.foto((api) => api.salvar(command));
        if (result.ok) this.invalidate(command.dados.produtoId);
        return result;
      },
      dados,
      motivo,
    );
  }
  novaRemocao(dados: { produtoId: number }, motivo: string) {
    return new GravacaoEstado<VinculoFoto, { produtoId: number }>(
      async (command: ComandoCadastro<{ produtoId: number }>) => {
        const result = await this.desktop.foto((api) => api.remover(command));
        if (result.ok) this.invalidate(command.dados.produtoId);
        return result;
      },
      dados,
      motivo,
    );
  }
  private invalidate(id: number) {
    this.reads.delete(id + 'miniatura');
    this.reads.delete(id + 'imagem');
  }
}
