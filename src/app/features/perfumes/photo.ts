import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  viewChild,
  untracked,
} from '@angular/core';
import type { ImagemFoto } from '../../../../shared/fotos';
import { FotosService } from '../../core/cadastros/fotos.service';
export function fotoUrl(image: ImagemFoto): string {
  return URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mime }));
}
@Component({
  selector: 'mnr-photo',
  template: `@if (url()) {
      <button
        type="button"
        class="thumbnail"
        [attr.aria-label]="'Ampliar fotografia de ' + name()"
        (click)="open()"
      >
        <img [src]="url()" alt="" width="64" height="64" />
      </button>
    } @else {
      <span
        class="placeholder"
        [attr.aria-label]="error() ? 'Fotografia indisponível' : 'Sem fotografia'"
        >{{ error() ? 'Falha na foto' : 'Sem foto' }}</span
      >
    }
    <dialog #dialog [attr.aria-label]="'Fotografia de ' + name()" (close)="close()">
      <button type="button" (click)="dialog.close()">Fechar fotografia</button>
      @if (large()) {
        <img class="large" [src]="large()" [alt]="'Fotografia de ' + name()" />
      } @else {
        <p role="status">{{ largeError() || 'Carregando fotografia…' }}</p>
      }
    </dialog>`,
  styles: [
    `
      :host {
        display: inline-block;
        max-width: 100%;
      }
      .thumbnail {
        padding: 0;
        border: 1px solid var(--border);
        background: var(--background);
        border-radius: 6px;
        cursor: pointer;
      }
      img {
        display: block;
        object-fit: contain;
        background: var(--background);
      }
      .placeholder {
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
        font-size: 11px;
        color: var(--text-secondary);
        border: 1px solid var(--border);
        border-radius: 6px;
      }
      dialog {
        max-width: calc(100% - 32px);
        max-height: calc(100% - 32px);
        overflow: auto;
        background: var(--surface);
        color: var(--text);
        border: 1px solid var(--control-border);
        border-radius: 10px;
        padding: 16px;
      }
      dialog::backdrop {
        background: #000b;
      }
      dialog button {
        min-height: 40px;
        margin-bottom: 12px;
        background: var(--surface-raised);
        color: var(--text);
        border: 1px solid var(--control-border);
        border-radius: 6px;
      }
      .large {
        max-width: 100%;
        max-height: 70vh;
        width: auto;
        height: auto;
      }
    `,
  ],
})
export class Photo implements OnDestroy {
  readonly produtoId = input.required<number>();
  readonly name = input.required<string>();
  readonly revision = input(0);
  private readonly photos = inject(FotosService);
  readonly url = signal('');
  readonly large = signal('');
  readonly error = signal(false);
  readonly largeError = signal('');
  readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private generation = 0;
  private destroyed = false;
  constructor() {
    effect(() => {
      const id = this.produtoId();
      this.revision();
      untracked(() => void this.load(id));
    });
  }
  private async load(id: number) {
    const generation = ++this.generation;
    this.release('url');
    this.error.set(false);
    const result = await this.photos.obter(id, 'miniatura');
    if (generation !== this.generation || this.destroyed) return;
    if (result.ok && result.data) this.url.set(fotoUrl(result.data));
    else if (!result.ok) this.error.set(true);
  }
  async open() {
    this.dialog().nativeElement.showModal();
    this.largeError.set('');
    const generation = this.generation;
    const result = await this.photos.obter(this.produtoId(), 'imagem');
    if (this.destroyed || generation !== this.generation || !this.dialog().nativeElement.open)
      return;
    if (result.ok && result.data) this.large.set(fotoUrl(result.data));
    else this.largeError.set('Não foi possível carregar a fotografia.');
  }
  close() {
    this.release('large');
  }
  private release(key: 'url' | 'large') {
    if (this[key]()) URL.revokeObjectURL(this[key]());
    this[key].set('');
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.generation;
    this.release('url');
    this.release('large');
  }
}
