import { Component, input, output } from '@angular/core';
@Component({ selector: 'mnr-field', templateUrl: './field.html', styleUrl: './field.scss' })
export class Field {
  readonly controlId = input.required<string>();
  readonly label = input.required<string>();
  readonly value = input('');
  readonly placeholder = input('');
  readonly hint = input('');
  readonly disabled = input(false);
  readonly readonly = input(false);
  readonly required = input(false);
  readonly error = input('');
  readonly maxLength = input(4000);
  readonly inputMode = input<'text' | 'decimal' | 'numeric'>('text');
  readonly multiline = input(false);
  readonly valueChanged = output<string>();
}
