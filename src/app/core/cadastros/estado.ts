import { signal } from '@angular/core';
import type { ComandoCadastro, ConsultaCadastro } from '../../../../shared/catalogos';
import type { ApiCadastro, ResultadoCadastro } from '../../../../shared/cadastros-ipc';

export type Estado<T> =
  | { fase: 'inicial' }
  | { fase: 'carregando' }
  | { fase: 'sucesso'; dados: T }
  | { fase: 'erro'; erro: Extract<ResultadoCadastro<T>, { ok: false }>['error'] };

export class ConsultaEstado<T> {
  readonly estado = signal<Estado<T[]>>({ fase: 'inicial' });
  private sequencia = 0;
  private consulta: ConsultaCadastro = {};
  constructor(
    private readonly listar: (consulta: ConsultaCadastro) => Promise<ResultadoCadastro<T[]>>,
  ) {}
  async carregar(consulta: ConsultaCadastro = {}) {
    const mudouFiltro =
      consulta.busca !== this.consulta.busca ||
      consulta.ativo !== this.consulta.ativo ||
      consulta.limite !== this.consulta.limite;
    this.consulta = { ...consulta, deslocamento: mudouFiltro ? 0 : (consulta.deslocamento ?? 0) };
    const sequencia = ++this.sequencia;
    this.estado.set({ fase: 'carregando' });
    const result = await this.listar({ ...this.consulta });
    if (sequencia !== this.sequencia) return;
    this.estado.set(
      result.ok ? { fase: 'sucesso', dados: result.data } : { fase: 'erro', erro: result.error },
    );
  }
}

// Each instance owns one immutable intention. Retry never reconstructs its payload.
export class GravacaoEstado<T, E> {
  readonly estado = signal<Estado<T>>({ fase: 'inicial' });
  private readonly original: ComandoCadastro<E>;
  private pendente?: Promise<ResultadoCadastro<T>>;
  constructor(
    private readonly salvar: ApiCadastro<T, E>['salvar'],
    dados: E,
    motivo: string,
  ) {
    this.original = structuredClone({ operacaoId: crypto.randomUUID(), motivo, dados });
  }
  executar(): Promise<ResultadoCadastro<T>> {
    if (this.pendente) return this.pendente;
    this.estado.set({ fase: 'carregando' });
    this.pendente = this.salvar(structuredClone(this.original))
      .then((result) => {
        this.estado.set(
          result.ok
            ? { fase: 'sucesso', dados: result.data }
            : { fase: 'erro', erro: result.error },
        );
        return result;
      })
      .finally(() => {
        this.pendente = undefined;
      });
    return this.pendente;
  }
}
