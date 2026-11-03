import { Component, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Produto } from '../../../../shared/catalogos';
import { ProdutosService } from '../../core/cadastros/produtos.service';
import { MarcasService } from '../../core/cadastros/marcas.service';
import { CategoriasService } from '../../core/cadastros/categorias.service';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { ContentState } from '../../shared/ui/content-state';
import { Photo } from './photo';

@Component({
  selector: 'mnr-perfumes',
  imports: [RouterLink, Badge, Button, ContentState, Photo],
  templateUrl: './perfumes.html',
  styleUrl: './perfumes.scss',
})
export class Perfumes implements OnDestroy {
  readonly produtos = inject(ProdutosService);
  private readonly marcas = inject(MarcasService);
  private readonly categorias = inject(CategoriasService);
  readonly consulta = this.produtos.novaConsulta();
  readonly rows = signal<Produto[]>([]);
  readonly names = signal<Record<string, string>>({});
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
    await Promise.all(
      this.rows().flatMap((p) => [this.resolve('m', p.marcaId), this.resolve('c', p.categoriaId)]),
    );
  }
  private readonly resolving = new Set<string>();
  private async resolve(kind: 'm' | 'c', id: number) {
    const key = kind + id;
    if (this.names()[key] || this.resolving.has(key)) return;
    this.resolving.add(key);
    const result = await (kind === 'm' ? this.marcas : this.categorias).obter(id);
    this.resolving.delete(key);
    if (result.ok) this.names.update((names) => ({ ...names, [key]: result.data.nome }));
  }
  filter() {
    clearTimeout(this.timer);
    void this.load(0);
  }
  searching(value: string) {
    this.search.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.filter(), 300);
  }
  price(value: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      value / 100,
    );
  }
  volume(value: number) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value / 1000);
  }
  ngOnDestroy() {
    clearTimeout(this.timer);
    ++this.generation;
  }
}
