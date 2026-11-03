import { Component, OnDestroy, inject, input, output, signal } from '@angular/core';
import type { EntradaFoto, PreparacaoFoto, VinculoFoto } from '../../../../shared/fotos';
import { FotosService } from '../../core/cadastros/fotos.service';
import { GravacaoEstado } from '../../core/cadastros/estado';
import { Button } from '../../shared/ui/button';
import { Photo, fotoUrl } from './photo';
@Component({
  selector: 'mnr-photo-editor',
  imports: [Button, Photo],
  template: `<div class="stack">
    <h3>Fotografia do perfume</h3>
    <p>
      Opcional. JPEG ou PNG estático, até 10 MiB e 24 milhões de pixels. A cópia local é preservada
      nas atualizações.
    </p>
    <div class="row">
      @if (preview()) {
        <img [src]="preview()" alt="Prévia da fotografia selecionada" width="160" height="160" />
      } @else if (produtoId() && !removing()) {
        <mnr-photo [produtoId]="produtoId()!" name="perfume" [revision]="revision()" />
      } @else {
        <p>Sem fotografia{{ removing() ? ' após salvar' : '' }}.</p>
      }
      <mnr-button
        variant="secondary"
        [disabled]="disabled() || busy() || uncertain()"
        (pressed)="select()"
        >Selecionar fotografia</mnr-button
      >
      @if (preparation() || produtoId()) {
        <mnr-button
          variant="secondary"
          [disabled]="disabled() || busy() || uncertain()"
          (pressed)="remove()"
          >Remover fotografia ao salvar</mnr-button
        >
      }
      @if (dirty() && !uncertain()) {
        <mnr-button variant="secondary" [disabled]="disabled() || busy()" (pressed)="undo()"
          >Desfazer alteração da foto</mnr-button
        >
      }
    </div>
    @if (message()) {
      <p [attr.role]="failed() ? 'alert' : 'status'">{{ message() }}</p>
    }
    @if (failed() && intention) {
      <mnr-button variant="secondary" [disabled]="disabled() || busy()" (pressed)="commit('')"
        >Tentar confirmar fotografia novamente</mnr-button
      >
    }
  </div>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--surface);
        padding: 20px;
      }
      img {
        object-fit: contain;
        max-width: 100%;
        background: var(--background);
        border-radius: 6px;
      }
    `,
  ],
})
export class PhotoEditor implements OnDestroy {
  readonly produtoId = input<number>();
  readonly disabled = input(false);
  readonly changed = output<boolean>();
  readonly pending = output<boolean>();
  readonly saved = output<boolean>();
  private readonly photos = inject(FotosService);
  readonly preparation = signal<PreparacaoFoto | null>(null);
  readonly preview = signal('');
  readonly removing = signal(false);
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly failed = signal(false);
  readonly message = signal('');
  readonly revision = signal(0);
  intention?:
    | GravacaoEstado<VinculoFoto, EntradaFoto>
    | GravacaoEstado<VinculoFoto, { produtoId: number }>;
  private destroyed = false;
  private release() {
    if (this.preview()) URL.revokeObjectURL(this.preview());
    this.preview.set('');
  }
  async select() {
    if (this.disabled() || this.busy() || this.uncertain()) return;
    this.busy.set(true);
    this.pending.emit(true);
    const result = await this.photos.selecionar();
    if (this.destroyed) {
      this.busy.set(false);
      if (result.ok && result.data) void this.photos.descartar(result.data.token);
      return;
    }
    if (!result.ok) {
      this.busy.set(false);
      this.pending.emit(false);
      this.failed.set(true);
      this.message.set(result.error.message);
      return;
    }
    if (!result.data) {
      this.busy.set(false);
      this.pending.emit(false);
      return;
    }
    await this.clearPreparation();
    this.preparation.set(result.data);
    this.preview.set(fotoUrl(result.data.previa));
    this.removing.set(false);
    this.mark(true);
    this.failed.set(false);
    this.message.set('Fotografia selecionada. Ela será aplicada após salvar o perfume.');
    this.busy.set(false);
    this.pending.emit(false);
  }
  private mark(value: boolean) {
    this.dirty.set(value);
    this.changed.emit(value);
  }
  private async clearPreparation() {
    const staged = this.preparation();
    this.preparation.set(null);
    this.release();
    if (staged) await this.photos.descartar(staged.token);
  }
  async remove() {
    if (this.disabled() || this.busy() || this.uncertain()) return;
    this.busy.set(true);
    this.pending.emit(true);
    await this.clearPreparation();
    this.removing.set(true);
    this.mark(true);
    this.message.set(
      'A fotografia será removida ao salvar. O cadastro e o histórico serão preservados.',
    );
    this.busy.set(false);
    this.pending.emit(false);
  }
  async undo() {
    if (this.disabled() || this.busy() || this.uncertain()) return;
    this.busy.set(true);
    this.pending.emit(true);
    await this.clearPreparation();
    this.removing.set(false);
    this.mark(false);
    this.failed.set(false);
    this.intention = undefined;
    this.message.set('Alteração da fotografia desfeita.');
    this.busy.set(false);
    this.pending.emit(false);
  }
  async commit(reason: string, produtoId = this.produtoId()): Promise<boolean> {
    if (!this.dirty()) return true;
    if (this.busy() || !produtoId) return false;
    if (!this.intention) {
      if (!reason.trim()) return false;
      this.intention = this.removing()
        ? this.photos.novaRemocao({ produtoId }, reason)
        : this.photos.novaGravacao({ produtoId, token: this.preparation()!.token }, reason);
    }
    this.busy.set(true);
    this.pending.emit(true);
    const result = await this.intention.executar();
    if (!result.ok) {
      this.busy.set(false);
      const uncertain = ['IPC_UNAVAILABLE', 'DATABASE_BUSY', 'INTERNAL_ERROR'].includes(
        result.error.code,
      );
      this.uncertain.set(uncertain);
      this.pending.emit(uncertain);
      this.failed.set(true);
      this.message.set('Perfume salvo. ' + result.error.message);
      if (!uncertain) this.intention = undefined;
      this.saved.emit(false);
      return false;
    }
    this.uncertain.set(false);
    this.failed.set(false);
    this.intention = undefined;
    await this.clearPreparation();
    this.removing.set(false);
    this.mark(false);
    this.revision.update((v) => v + 1);
    this.message.set('Fotografia atualizada com sucesso.');
    this.busy.set(false);
    this.pending.emit(false);
    this.saved.emit(true);
    return true;
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.release();
    if (!this.uncertain() && !this.busy()) {
      const staged = this.preparation();
      if (staged) void this.photos.descartar(staged.token);
    }
  }
}
