import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EstoqueService } from '../../core/estoque.service';
import type { PaginaEstoque } from '../../../../shared/estoque-ipc';
import { Button } from '../../shared/ui/button';
import { Badge } from '../../shared/ui/badge';
import { ContentState } from '../../shared/ui/content-state';
import { reais } from './format';

@Component({
  selector: 'mnr-estoque',
  imports: [RouterLink, Button, Badge, ContentState],
  templateUrl: './estoque.html',
  styleUrl: './estoque.scss',
})
export class Estoque implements OnInit, OnDestroy {
  private readonly service = inject(EstoqueService);
  readonly dados = signal<PaginaEstoque | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly search = signal('');
  readonly active = signal('true');
  readonly low = signal(false);
  readonly page = signal(0);
  readonly reais = reais;
  private sequence = 0;
  private filterKey = '';
  private requestedPage = 0;
  retry() {
    return this.load(this.requestedPage);
  }
  ngOnInit() {
    void this.load();
  }
  ngOnDestroy() {
    ++this.sequence;
  }
  async load(page = 0) {
    const key = JSON.stringify([this.search(), this.active(), this.low()]);
    if (key !== this.filterKey) page = 0;
    this.filterKey = key;
    this.requestedPage = page;
    const sequence = ++this.sequence;
    this.loading.set(true);
    this.error.set('');
    const result = await this.service.listar({
      busca: this.search(),
      ativo: this.active() === 'all' ? undefined : this.active() === 'true',
      somenteBaixo: this.low(),
      limite: 25,
      deslocamento: page * 25,
    });
    if (sequence !== this.sequence) return;
    this.loading.set(false);
    if (!result.ok) {
      this.error.set(result.error.message);
      return;
    }
    if (!result.data.itens.length && page > 0) {
      await this.load(page - 1);
      return;
    }
    this.page.set(page);
    this.dados.set(result.data);
  }
}
