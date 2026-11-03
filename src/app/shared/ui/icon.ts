import { Component, input } from '@angular/core';
export type IconName =
  | 'finance'
  | 'dashboard'
  | 'perfumes'
  | 'stock'
  | 'sales'
  | 'purchases'
  | 'clients'
  | 'suppliers'
  | 'reports'
  | 'settings'
  | 'menu'
  | 'arrow'
  | 'info'
  | 'check'
  | 'warning'
  | 'clock';
const paths: Record<IconName, string> = {
  finance: 'M3 5h18v14H3z M3 9h18 M7 14h3 M16 13v3 M14 14.5h4',
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  perfumes: 'M9 3h6v4H9z M8 7h8v3H8z M6 10h12v11H6z M9 14h6',
  stock: 'M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10',
  sales: 'M3 3h2l3 12h11l2-8H6 M9 20h.01 M18 20h.01',
  purchases: 'M5 7h14l1 14H4z M9 8V6a3 3 0 0 1 6 0v2',
  clients:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87',
  suppliers: 'M3 21V3h12v18 M15 9h6v12 M1 21h22 M6 7h6 M6 11h6 M6 15h6 M18 13v4',
  reports: 'M4 3v18h17 M8 17v-5 M13 17V7 M18 17v-8',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  info: 'M12 11v6 M12 7h.01 M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0',
  check: 'M5 12l4 4L19 6',
  warning: 'M12 3L2 21h20z M12 9v5 M12 18h.01',
  clock: 'M12 6v6l4 2 M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0',
};
@Component({
  selector: 'mnr-icon',
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path [attr.d]="paths[name()]" /></svg>',
  styles: [
    ':host { display: inline-flex; width: 20px; height: 20px; flex: 0 0 20px; } svg { width: 100%; height: 100%; }',
  ],
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly paths = paths;
}
