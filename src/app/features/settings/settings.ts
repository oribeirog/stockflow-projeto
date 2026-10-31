import { Component, inject, signal } from '@angular/core';
import { DesktopService } from '../../core/desktop.service';
import { SystemStatus } from '../../../../shared/contracts';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ContentState } from '../../shared/ui/content-state';

type Diagnostic =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: SystemStatus };
@Component({
  selector: 'mnr-settings',
  imports: [Badge, Button, Card, ContentState],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly desktop = inject(DesktopService);
  readonly diagnostic = signal<Diagnostic>({ state: 'loading' });
  constructor() {
    void this.refresh();
  }
  async refresh() {
    this.diagnostic.set({ state: 'loading' });
    try {
      const result = await this.desktop.status();
      this.diagnostic.set(
        result.ok
          ? { state: 'ready', data: result.data }
          : { state: 'error', message: result.error.message },
      );
    } catch {
      this.diagnostic.set({
        state: 'error',
        message:
          'Não foi possível consultar o ambiente. Abra pelo aplicativo desktop e tente novamente.',
      });
    }
  }
}
