import { Component, HostListener, OnDestroy, inject, signal } from '@angular/core';
import { DesktopService } from '../../core/desktop.service';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Confirm } from '../../shared/ui/confirm';
import type { BackupReview, BackupStatus } from '../../../../shared/backup';
import type { Result } from '../../../../shared/contracts';
@Component({
  selector: 'mnr-backup',
  imports: [Button, Card, Confirm],
  templateUrl: './backup.html',
  styleUrl: './backup.scss',
})
export class BackupPage implements OnDestroy {
  private readonly api = inject(DesktopService).backupApi();
  readonly available = !!this.api;
  readonly busy = signal(false);
  readonly status = signal<BackupStatus | undefined>(undefined);
  readonly review = signal<BackupReview | undefined>(undefined);
  readonly acknowledged = signal(false);
  readonly confirming = signal(false);
  readonly message = signal('');
  readonly failed = signal(false);
  readonly restarting = signal(false);
  readonly warning =
    'A restauração substituirá os dados atuais pelos dados deste backup. Operações realizadas depois da data do backup poderão deixar de aparecer no aplicativo.';
  private alive = true;
  private readonly timer = setInterval(() => void this.refresh(), 700);
  constructor() {
    if (!this.api) {
      this.message.set('Abra pelo aplicativo desktop para proteger e restaurar os dados.');
      this.failed.set(true);
    } else void this.refresh();
  }
  date(v: string) {
    return new Date(v).toLocaleString('pt-BR');
  }
  size(v: number) {
    return (
      (v / 1024 ** 2).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + ' MiB'
    );
  }
  private focus(id = 'backup-message') {
    setTimeout(() => {
      const el = document.getElementById(id);
      (el?.matches('mnr-button') ? el.querySelector<HTMLButtonElement>('button') : el)?.focus();
    }, 0);
  }
  private async refresh() {
    try {
      const r = await this.api?.estado();
      if (this.alive && r?.ok) this.status.set(r.data);
    } catch {
      /* Existing phase remains visible while the application restarts. */
    }
  }
  private async action<T>(call: () => Promise<Result<T>>) {
    if (this.busy() || this.restarting()) return;
    this.busy.set(true);
    this.message.set('');
    this.failed.set(false);
    try {
      const r = await call();
      if (!r.ok) throw Error(r.error.message);
      return r.data;
    } catch (e) {
      this.failed.set(true);
      this.message.set(
        e instanceof Error
          ? e.message
          : 'Resultado indisponível. Consulte o estado e tente novamente.',
      );
      this.focus();
      return undefined;
    } finally {
      if (this.alive) {
        this.busy.set(false);
        void this.refresh();
      }
    }
  }
  async create() {
    if (!this.api) {
      this.message.set('Abra pelo aplicativo desktop para proteger os dados.');
      this.failed.set(true);
      return;
    }
    const r = await this.action(() => this.api!.criar());
    if (r) {
      this.message.set(
        `Backup concluído: ${r.nome} · ${this.date(r.criadoEm)} · ${this.size(r.bytes)}. Guarde uma cópia protegida fora deste computador.`,
      );
      this.focus();
    } else if (r === null) {
      this.message.set('Seleção cancelada. Nenhum backup foi criado.');
      this.focus('backup-create');
    }
  }
  async inspect() {
    if (!this.api) return;
    const r = await this.action(() => this.api!.selecionar());
    if (r) {
      this.review.set(r);
      this.acknowledged.set(false);
      this.focus('backup-review-title');
    } else if (r === null) {
      this.message.set('Seleção cancelada. Os dados atuais foram preservados.');
      this.focus('backup-select');
    } else if (this.failed()) {
      this.review.set(undefined);
      this.acknowledged.set(false);
    }
  }
  async discard() {
    const r = this.review();
    if (!this.api || !r) return;
    const result = await this.action(() => this.api!.descartar({ token: r.token }));
    if (result === null) {
      this.review.set(undefined);
      this.acknowledged.set(false);
      this.message.set('Revisão descartada. Os dados atuais foram preservados.');
      this.focus('backup-select');
    }
  }
  ask() {
    if (this.review() && this.acknowledged() && !this.busy()) this.confirming.set(true);
  }
  cancelConfirmation() {
    this.confirming.set(false);
    this.focus('backup-restore');
  }
  async restore() {
    this.confirming.set(false);
    const r = this.review();
    if (!r || !this.api || !this.acknowledged()) return;
    const result = await this.action(() =>
      this.api!.restaurar({ token: r.token, confirmacao: 'RESTAURAR' }),
    );
    if (result) {
      this.restarting.set(true);
      this.message.set(
        'Reiniciando para verificar e concluir a restauração ou recuperar o conjunto anterior. A restauração ainda não foi confirmada como concluída.',
      );
      this.focus();
    }
  }
  async openProtections() {
    if (this.api) await this.action(() => this.api!.abrirProtecoes());
  }
  canLeave() {
    return !this.busy() && !this.restarting();
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(e: BeforeUnloadEvent) {
    if (this.busy() && !this.restarting()) e.preventDefault();
  }
  ngOnDestroy() {
    this.alive = false;
    clearInterval(this.timer);
    const r = this.review();
    if (r && !this.restarting())
      void this.api?.descartar({ token: r.token }).catch(() => undefined);
  }
}
