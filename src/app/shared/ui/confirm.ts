import {
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  viewChild,
  signal,
} from '@angular/core';
import { Button } from './button';
import { Field } from './field';
@Component({
  selector: 'mnr-confirm',
  imports: [Button, Field],
  template: `<dialog
    #dialog
    aria-labelledby="confirm-title"
    (cancel)="$event.preventDefault(); cancelled.emit()"
  >
    <div class="stack">
      <h2 id="confirm-title" tabindex="-1">{{ title() }}</h2>
      <p>{{ description() }}</p>
      @if (reasonRequired()) {
        <mnr-field
          controlId="confirm-reason"
          label="Justificativa"
          [required]="true"
          [multiline]="true"
          [value]="reason()"
          [error]="reasonError()"
          (valueChanged)="reason.set($event)"
        />
      }
      <div class="row">
        <mnr-button variant="secondary" (pressed)="cancelled.emit()">Voltar</mnr-button
        ><mnr-button
          [disabled]="reasonRequired() && !reason().trim()"
          (pressed)="confirmed.emit(reason())"
          >Confirmar</mnr-button
        >
      </div>
    </div>
  </dialog>`,
  styles: [
    `
      dialog {
        width: min(520px, calc(100% - 32px));
        max-height: calc(100% - 32px);
        overflow: auto;
        border: 1px solid var(--control-border);
        border-radius: var(--radius-card);
        background: var(--surface);
        color: var(--text);
        padding: 24px;
      }
      dialog::backdrop {
        background: #0009;
      }
      p {
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class Confirm {
  readonly focusReview = input(false);
  readonly title = input.required<string>();
  readonly description = input('');
  readonly reasonRequired = input(false);
  readonly reasonError = input('');
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();
  readonly reason = signal('');
  readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  constructor() {
    afterNextRender(() => {
      const dialog = this.dialog().nativeElement;
      dialog.showModal();
      if (this.focusReview()) dialog.querySelector<HTMLElement>('h2')?.focus();
    });
  }
}
