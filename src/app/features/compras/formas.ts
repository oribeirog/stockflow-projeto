import { Component, HostListener, OnInit, OnDestroy, inject, signal, output } from '@angular/core';
import { FormasPagamentoService } from '../../core/cadastros/formas-pagamento.service';
import { GravacaoEstado } from '../../core/cadastros/estado';
import type { Referencia, EntradaReferencia } from '../../../../shared/catalogos';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { Confirm } from '../../shared/ui/confirm';

@Component({
  selector: 'mnr-formas-pagamento',
  imports: [Button, Field, Confirm],
  templateUrl: './formas.html',
  styleUrl: './compras.scss',
})
export class FormasPagamento implements OnInit, OnDestroy {
  private readonly service = inject(FormasPagamentoService);
  readonly pending = output<boolean>();
  readonly changed = output<void>();
  readonly rows = signal<Referencia[]>([]);
  readonly search = signal('');
  readonly status = signal('true');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly locked = signal(false);
  readonly dirty = signal(false);
  readonly message = signal('');
  readonly nameError = signal('');
  readonly reasonError = signal('');
  readonly more = signal(false);
  readonly editing = signal(false);
  readonly id = signal<number | undefined>(undefined);
  readonly name = signal('');
  readonly active = signal(true);
  readonly reason = signal('');
  readonly confirmation = signal(false);
  page = 0;
  private sequence = 0;
  private destroyed = false;
  private intention?: GravacaoEstado<Referencia, EntradaReferencia>;
  ngOnInit() {
    void this.load();
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.sequence;
  }
  async load(page = 0) {
    const seq = ++this.sequence;
    this.loading.set(true);
    const r = await this.service.listar({
      busca: this.search(),
      ativo: this.status() === '' ? undefined : this.status() === 'true',
      limite: 26,
      deslocamento: page * 25,
    });
    if (this.destroyed || seq !== this.sequence) return;
    this.loading.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      return;
    }
    this.page = page;
    this.rows.set(r.data.slice(0, 25));
    this.more.set(r.data.length > 25);
  }
  async edit(id?: number) {
    if (this.locked() || this.busy() || this.dirty()) return;
    this.message.set('');
    this.nameError.set('');
    this.reasonError.set('');
    if (id !== undefined) {
      this.busy.set(true);
      const r = await this.service.obter(id);
      this.busy.set(false);
      if (!r.ok) {
        this.message.set(r.error.message);
        return;
      }
      this.id.set(id);
      this.name.set(r.data.nome);
      this.active.set(r.data.ativo);
    } else {
      this.id.set(undefined);
      this.name.set('');
      this.active.set(true);
    }
    this.reason.set('');
    this.editing.set(true);
    this.dirty.set(false);
  }
  change() {
    this.dirty.set(true);
    this.pending.emit(true);
  }
  prepare() {
    if (this.locked() || this.busy()) return;
    this.nameError.set(
      !this.name().trim() || this.name().length > 120
        ? 'Informe um nome de até 120 caracteres.'
        : '',
    );
    this.reasonError.set(
      !this.reason().trim() || this.reason().length > 4000
        ? 'Informe uma justificativa de até 4.000 caracteres.'
        : '',
    );
    if (
      !this.name().trim() ||
      this.name().length > 120 ||
      !this.reason().trim() ||
      this.reason().length > 4000
    ) {
      this.message.set(
        'Informe nome de até 120 caracteres e justificativa de até 4.000 caracteres.',
      );
      setTimeout(
        () =>
          document
            .querySelector<HTMLInputElement>('mnr-formas-pagamento [aria-invalid="true"]')
            ?.focus(),
        0,
      );
      return;
    }
    this.confirmation.set(true);
  }
  async save() {
    if (this.busy()) return;
    this.confirmation.set(false);
    this.intention ??= this.service.novaGravacao(
      { id: this.id(), nome: this.name(), ativo: this.active() },
      this.reason(),
    );
    this.busy.set(true);
    this.pending.emit(true);
    const r = await this.intention.executar();
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      this.locked.set(
        ['IPC_UNAVAILABLE', 'DATABASE_BUSY', 'INTERNAL_ERROR', 'IDEMPOTENCY_CONFLICT'].includes(
          r.error.code,
        ),
      );
      if (!this.locked()) this.intention = undefined;
      return;
    }
    this.intention = undefined;
    this.locked.set(false);
    this.dirty.set(false);
    this.editing.set(false);
    this.pending.emit(false);
    this.changed.emit();
    this.message.set('Forma de pagamento salva.');
    await this.load();
  }
  cancel() {
    if (this.locked() || this.busy()) return;
    this.editing.set(false);
    this.dirty.set(false);
    this.pending.emit(false);
  }
  canLeave() {
    return !this.locked() && !this.busy() && !this.dirty();
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (!this.canLeave()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
