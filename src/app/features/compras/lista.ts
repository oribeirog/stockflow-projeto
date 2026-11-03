import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ComprasService } from '../../core/compras.service';
import { FornecedoresService } from '../../core/cadastros/fornecedores.service';
import type { PaginaCompras } from '../../../../shared/compras-ipc';
import type { EstadoDocumento } from '../../../../shared/comercial';
import type { Pessoa } from '../../../../shared/catalogos';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { reais } from '../estoque/format';
@Component({
  selector: 'mnr-compras',
  imports: [RouterLink, Button, Field],
  templateUrl: './lista.html',
  styleUrl: './compras.scss',
})
export class Compras implements OnInit, OnDestroy {
  private readonly service = inject(ComprasService);
  private readonly suppliers = inject(FornecedoresService);
  readonly result = signal<PaginaCompras | null>(null);
  readonly loading = signal(false);
  readonly message = signal('');
  readonly state = signal('');
  readonly supplier = signal('');
  readonly search = signal('');
  readonly options = signal<Pessoa[]>([]);
  readonly supplierMore = signal(false);
  readonly reais = reais;
  page = 0;
  private seq = 0;
  private supplierSeq = 0;
  private destroyed = false;
  private supplierOffset = 0;
  ngOnInit() {
    void this.load();
    void this.findSuppliers();
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.seq;
    ++this.supplierSeq;
  }
  async findSuppliers(more = false) {
    const seq = ++this.supplierSeq;
    const offset = more ? this.supplierOffset + 25 : 0;
    const r = await this.suppliers.listar({
      busca: this.search(),
      limite: 26,
      deslocamento: offset,
    });
    if (this.destroyed || seq !== this.supplierSeq) return;
    if (!r.ok) {
      this.message.set(r.error.message);
      return;
    }
    this.supplierOffset = offset;
    this.options.set([...(more ? this.options() : []), ...r.data.slice(0, 25)]);
    this.supplierMore.set(r.data.length > 25);
  }
  async load(page = 0) {
    const seq = ++this.seq;
    this.loading.set(true);
    this.message.set('');
    const r = await this.service.listar({
      estado: this.state() ? (this.state() as EstadoDocumento) : undefined,
      fornecedorId: this.supplier() ? Number(this.supplier()) : undefined,
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
