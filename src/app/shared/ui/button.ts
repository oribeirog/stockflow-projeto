import { Component, input, output } from '@angular/core';
@Component({
  selector: 'mnr-button',
  template:
    '<button [type]="type()" [class.secondary]="variant() === &quot;secondary&quot;" [disabled]="disabled()" (click)="pressed.emit()"><ng-content /></button>',
  styleUrl: './button.scss',
})
export class Button {
  readonly variant = input<'primary' | 'secondary'>('primary');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly pressed = output<void>();
}
