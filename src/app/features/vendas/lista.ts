import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VendasService } from '../../core/vendas.service';
import { ClientesService } from '../../core/cadastros/clientes.service';
import type { PaginaVendas } from '../../../../shared/vendas-ipc';
import type { EstadoDocumento } from '../../../../shared/comercial';
import type { Pessoa } from '../../../../shared/catalogos';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { reais } from '../estoque/format';
@Component({
  selector: 'mnr-vendas',
  imports: [RouterLink, Button, Field],
  templateUrl: './lista.html',
  styleUrl: './vendas.scss',
})
export class Vendas implements OnInit, OnDestroy {
  private readonly service = inject(VendasService);
  private readonly clients = inject(ClientesService);
  readonly result = signal<PaginaVendas | null>(null);
  readonly loading = signal(false);
  readonly message = signal('');
  readonly state = signal('');
  readonly client = signal('');
  readonly search = signal('');
  readonly options = signal<Pessoa[]>([]);
  readonly clientMore = signal(false);
  readonly reais = reais;
  page = 0;
  private seq = 0;
  private clientSeq = 0;
  private destroyed = false;
  private clientOffset = 0;
  ngOnInit() {
    void this.load();
    void this.findClients();
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.seq;
    ++this.clientSeq;
  }
  async findClients(more = false) {
    const seq = ++this.clientSeq;
    const offset = more ? this.clientOffset + 25 : 0;
    const r = await this.clients.listar({
      busca: this.search(),
      limite: 26,
      deslocamento: offset,
    });
    if (this.destroyed || seq !== this.clientSeq) return;
    if (!r.ok) {
      this.message.set(r.error.message);
      return;
    }
    this.clientOffset = offset;
    this.options.set([...(more ? this.options() : []), ...r.data.slice(0, 25)]);
    this.clientMore.set(r.data.length > 25);
  }
  async load(page = 0) {
    const seq = ++this.seq;
    this.loading.set(true);
    this.message.set('');
    const r = await this.service.listar({
      estado: this.state() ? (this.state() as EstadoDocumento) : undefined,
      clienteId: this.client() ? Number(this.client()) : undefined,
      limite: 25,
      deslocamento: page * 25,
    });
    if (this.destroyed || seq !== this.seq) return;
    this.loading.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      return;
    }
    this.page = page;
    this.result.set(r.data);
  }
}
