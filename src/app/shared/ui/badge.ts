import { Component, input } from '@angular/core';
@Component({
  selector: 'mnr-badge',
  template: '<span [class]="tone()"><ng-content /></span>',
  styles: [
    ':host { display: inline-flex; } span { padding: 4px 8px; border-radius: var(--radius-control); background: var(--surface-raised); color: var(--text-secondary); font-size: var(--text-small); font-weight: 600; } .success { color: var(--success); } .warning { color: var(--warning); } .error { color: var(--error); }',
  ],
})
export class Badge {
  readonly tone = input<'neutral' | 'success' | 'warning' | 'error'>('neutral');
}
