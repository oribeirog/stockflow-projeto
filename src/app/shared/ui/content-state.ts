import { Component, input } from '@angular/core';
import { Icon, IconName } from './icon';
@Component({
  selector: 'mnr-content-state',
  imports: [Icon],
  templateUrl: './content-state.html',
  styles: [
    ':host { display: block; } :host > div { display: flex; gap: var(--space-3); padding: var(--space-5); background: var(--background); border: 1px solid var(--border); border-radius: var(--radius-control); } h3 { margin-bottom: var(--space-2); } .error mnr-icon { color: var(--error); } .loading mnr-icon { color: var(--focus); } p { margin-bottom: var(--space-3); } p:last-child { margin-bottom: 0; }',
  ],
})
export class ContentState {
  readonly kind = input<'loading' | 'empty' | 'error' | 'upcoming'>('empty');
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly icons: Record<'loading' | 'empty' | 'error' | 'upcoming', IconName> = {
    loading: 'clock',
    empty: 'info',
    error: 'warning',
    upcoming: 'clock',
  };
}
