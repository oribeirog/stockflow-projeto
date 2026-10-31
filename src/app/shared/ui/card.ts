import { Component } from '@angular/core';
@Component({
  selector: 'mnr-card',
  template: '<ng-content />',
  styles: [
    ':host { display: block; min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }',
  ],
})
export class Card {}
