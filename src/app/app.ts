import { Component, inject, signal } from '@angular/core';
import { DesktopService } from './core/desktop.service';
@Component({
  selector: 'app-root',
  template: `<main>
    <span>MNR SOFTWARE</span>
    <h1>MNR Perfumes</h1>
    <p>Ambiente desktop inicial</p>
    <p role="status">{{ status() }}</p>
  </main>`,
})
export class App {
  readonly status = signal('Verificando ambiente?');
  private readonly desktop = inject(DesktopService);
  constructor() {
    void this.desktop
      .status()
      .then((result) =>
        this.status.set(result.ok ? 'Electron e SQLite conectados.' : result.error.message),
      )
      .catch(() => this.status.set('Abra pelo aplicativo desktop.'));
  }
}
