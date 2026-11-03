import { Component, OnInit, OnDestroy, inject, input, output, signal } from '@angular/core';
import type { Referencia, EntradaReferencia } from '../../../../shared/catalogos';
import { MarcasService } from '../../core/cadastros/marcas.service';
import { CategoriasService } from '../../core/cadastros/categorias.service';
import { GravacaoEstado } from '../../core/cadastros/estado';
import { Field } from './field';
import { Button } from './button';

@Component({
  selector: 'mnr-reference-picker',
  imports: [Field, Button],
  template: ` <div class="stack" style="gap: var(--space-3)">
    <mnr-field
      [controlId]="kind() + '-search'"
      [label]="'Pesquisar ' + label()"
      [maxLength]="120"
      [disabled]="disabled() || locked()"
      [value]="search()"
      (valueChanged)="search.set($event); load(0)"
    />
    <div>
      <label [for]="kind() + '-select'">{{ label() }} *</label>
      <select
        [id]="kind() + '-select'"
        [disabled]="disabled() || locked()"
        [value]="selected()?.id || ''"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="kind() + '-message'"
        (change)="choose($any($event.target).value)"
      >
        <option value="" [selected]="!selected()">Selecione</option>
        @if (selected() && !includesSelected()) {
          <option [value]="selected()!.id" [selected]="true">
            {{ selected()!.nome }}{{ selected()!.ativo ? '' : ' (inativa — vínculo atual)' }}
          </option>
        }
        @for (r of rows(); track r.id) {
          <option [value]="r.id" [selected]="r.id === selected()?.id">{{ r.nome }}</option>
        }
      </select>
    </div>
    <p [id]="kind() + '-message'" [class.error]="error() || message()">
      {{
        error() ||
          message() ||
          (loading()
            ? 'Carregando opções…'
            : !rows().length
              ? 'Nenhuma opção ativa. Cadastre uma abaixo.'
              : 'Selecione uma opção ativa.')
      }}
    </p>
    @if (more()) {
      <mnr-button
        variant="secondary"
        [disabled]="disabled() || loading() || locked()"
        (pressed)="load(offset + 25)"
        >Carregar mais opções</mnr-button
      >
    }
    <details>
      <summary>Cadastrar {{ label() }}</summary>
      <div class="quick">
        <mnr-field
          [controlId]="kind() + '-new'"
          label="Nome"
          [maxLength]="120"
          [disabled]="disabled() || locked()"
          [value]="newName()"
          (valueChanged)="newName.set($event)"
        />
        <mnr-button
          variant="secondary"
          [disabled]="disabled() || saving() || (!locked() && !newName().trim())"
          (pressed)="create()"
          >{{ locked() ? 'Tentar confirmar novamente' : 'Cadastrar e selecionar' }}</mnr-button
        >
      </div>
    </details>
  </div>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      label {
        display: block;
        font-weight: 600;
        margin-bottom: 8px;
      }
      select {
        width: 100%;
        min-width: 0;
        height: 40px;
        background: var(--background);
        color: var(--text);
        border: 1px solid var(--control-border);
        border-radius: 6px;
        padding: 8px;
      }
      .quick {
        display: grid;
        gap: 12px;
        margin-top: 12px;
      }
      summary {
        color: var(--focus);
        cursor: pointer;
      }
      .error {
        color: var(--error);
      }
    `,
  ],
})
export class ReferencePicker implements OnInit, OnDestroy {
  readonly kind = input.required<'marca' | 'categoria'>();
  readonly label = input.required<string>();
  readonly selected = input<Referencia | null>(null);
  readonly disabled = input(false);
  readonly error = input('');
  readonly changed = output<Referencia>();
  readonly pending = output<boolean>();
  private readonly marcas = inject(MarcasService);
  private readonly categorias = inject(CategoriasService);
  readonly rows = signal<Referencia[]>([]);
  readonly search = signal('');
  readonly newName = signal('');
  readonly more = signal(false);
  readonly message = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly locked = signal(false);
  offset = 0;
  private sequence = 0;
  private intention?: GravacaoEstado<Referencia, EntradaReferencia>;
  private get service() {
    return this.kind() === 'marca' ? this.marcas : this.categorias;
  }
  ngOnInit() {
    void this.load(0);
  }
  ngOnDestroy() {
    ++this.sequence;
  }
  includesSelected() {
    return this.rows().some((r) => r.id === this.selected()?.id);
  }
  async load(offset: number) {
    const sequence = ++this.sequence;
    this.loading.set(true);
    this.message.set('');
    const result = await this.service.listar({
      busca: this.search(),
      ativo: true,
      limite: 26,
      deslocamento: offset,
    });
    if (sequence !== this.sequence) return;
    this.loading.set(false);
    if (!result.ok) {
      this.message.set(result.error.message);
      return;
    }
    this.offset = offset;
    this.more.set(result.data.length > 25);
    this.rows.set([
      ...new Map(
        [...(offset ? this.rows() : []), ...result.data.slice(0, 25)].map((r) => [r.id, r]),
      ).values(),
    ]);
  }
  choose(value: string) {
    const item = this.rows().find((r) => r.id === Number(value));
    if (item) this.changed.emit(item);
  }
  async create() {
    if (this.saving() || this.disabled()) return;
    this.intention ??= this.service.novaGravacao(
      { nome: this.newName(), ativo: true },
      'Cadastro rápido de ' + this.label(),
    );
    this.saving.set(true);
    this.pending.emit(true);
    const result = await this.intention.executar();
    this.saving.set(false);
    if (result.ok) {
      this.changed.emit(result.data);
      this.newName.set('');
      this.intention = undefined;
      this.locked.set(false);
      this.pending.emit(false);
      await this.load(0);
    } else {
      this.message.set(result.error.message);
      const uncertain = ['IPC_UNAVAILABLE', 'DATABASE_BUSY', 'INTERNAL_ERROR'].includes(
        result.error.code,
      );
      this.locked.set(uncertain);
      this.pending.emit(uncertain);
      if (!uncertain) this.intention = undefined;
    }
  }
}
