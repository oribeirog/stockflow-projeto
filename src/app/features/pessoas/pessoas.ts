import { Component, OnDestroy, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Pessoa } from '../../../../shared/catalogos';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { ContentState } from '../../shared/ui/content-state';
import { contextoPessoa } from './contexto';

@Component({
  selector: 'mnr-pessoas',
  imports: [RouterLink, Badge, Button, ContentState],
  templateUrl: './pessoas.html',
  styleUrl: './pessoas.scss',
})
export class Pessoas implements OnDestroy {
  readonly contexto = contextoPessoa();
  readonly consulta = this.contexto.service.novaConsulta();
  readonly rows = signal<Pessoa[]>([]);
  readonly page = signal(0);
  readonly next = signal(false);
  readonly search = signal('');
  readonly active = signal('true');
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor() {
    void this.load();
  }
  async load(page = this.page()) {
    const generation = ++this.generation;
    this.page.set(page);
    await this.consulta.carregar({
      busca: this.search(),
      ativo: this.active() === 'all' ? undefined : this.active() === 'true',
      limite: 26,
      deslocamento: page * 25,
    });
    if (generation !== this.generation) return;
    const state = this.consulta.estado();
    if (state.fase !== 'sucesso') return;
    if (!state.dados.length && page > 0) {
      await this.load(page - 1);
      return;
    }
    this.rows.set(state.dados.slice(0, 25));
    this.next.set(state.dados.length > 25);
  }
  filter() {
    clearTimeout(this.timer);
    void this.load(0);
  }
  searching(value: string) {
    this.search.set(value);
    // Immediately invalidate the in-flight result, including during the debounce window.
    ++this.generation;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.filter(), 300);
  }
  ngOnDestroy() {
    clearTimeout(this.timer);
    ++this.generation;
  }
}
