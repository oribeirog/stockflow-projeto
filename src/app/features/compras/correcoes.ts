import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CorrecoesComprasService } from '../../core/correcoes-compras.service';
import type {
  ContextoCorrecaoCompra,
  CorrecaoCompraResumo,
  DetalheCorrecaoCompra,
} from '../../../../shared/correcoes-compras-ipc';
import { Button } from '../../shared/ui/button';
import { reais } from '../estoque/format';
@Component({
  selector: 'mnr-compra-correcoes',
  imports: [RouterLink, Button],
  templateUrl: './correcoes.html',
  styleUrl: './correcao.scss',
})
export class CompraCorrecoes implements OnInit, OnDestroy {
  private readonly service = inject(CorrecoesComprasService);
  private readonly route = inject(ActivatedRoute);
  readonly id = Number(this.route.snapshot.paramMap.get('id'));
  readonly contexto = signal<ContextoCorrecaoCompra | null>(null);
  readonly docs = signal<CorrecaoCompraResumo[]>([]);
  readonly detail = signal<DetalheCorrecaoCompra | null>(null);
  readonly more = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly reais = reais;
  private destroyed = false;
  ngOnInit() {
    void this.load();
  }
  ngOnDestroy() {
    this.destroyed = true;
  }
  async load() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const c = await this.service.consultar((api) => api.obterContexto(this.id));
    if (this.destroyed) return;
    if (!c.ok) {
      this.error.set(c.error.message);
      this.busy.set(false);
      return;
    }
    this.contexto.set(c.data);
    this.busy.set(false);
    await this.list(false);
    const doc = this.route.snapshot.queryParamMap.get('documentoId');
    if (doc) await this.open(Number(doc));
  }
  async list(more: boolean) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const r = await this.service.consultar((api) =>
      api.listarDocumentos({
        compraId: this.id,
        aposId: more ? this.docs().at(-1)?.id : undefined,
      }),
    );
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.error.set(r.error.message);
      return;
    }
    this.docs.set(more ? [...this.docs(), ...r.data.itens] : r.data.itens);
    this.more.set(r.data.temMais);
  }
  async open(documentoId: number) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.detail.set(null);
    const r = await this.service.consultar((api) =>
      api.obterDocumento({ compraId: this.id, documentoId }),
    );
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.error.set(r.error.message);
      return;
    }
    this.detail.set(r.data);
    setTimeout(() => document.getElementById('compra-correcao-documento')?.focus(), 0);
  }
}
