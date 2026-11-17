import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { DesktopService } from './desktop.service';
import type { RecurringBackupStatus, BackupDeferral } from '../../../shared/backup-policy';
import type { Result } from '../../../shared/contracts';

@Injectable({ providedIn: 'root' })
export class BackupPolicyClient implements OnDestroy {
  readonly api = inject(DesktopService).recurringBackupApi();
  readonly state = signal<RecurringBackupStatus | undefined>(undefined);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly postponed = signal(false);
  readonly protectedNotice = signal(false);
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private alive = true;
  private timer = this.api ? setInterval(() => void this.refresh(), 1500) : undefined;
  constructor() {
    void this.refresh();
  }
  async refresh(use = false) {
    try {
      const r = await (use ? this.api?.utilizar() : this.api?.estado());
      if (this.alive && r?.ok) {
        const previous = this.state();
        if (
          previous &&
          r.data.ultimoBackup &&
          !r.data.devido &&
          r.data.ultimoBackup.nome !== previous.ultimoBackup?.nome
        ) {
          this.protectedNotice.set(true);
          if (this.noticeTimer) clearTimeout(this.noticeTimer);
          this.noticeTimer = setTimeout(() => this.protectedNotice.set(false), 8000);
        }
        this.state.set(r.data);
        if (!r.data.devido) this.postponed.set(false);
      }
    } catch {
      /* Pending/error indicator remains visible during restart. */
    }
  }
  async action(
    call: () => Promise<Result<RecurringBackupStatus | null>>,
    success = 'Configuração atualizada. A obrigação só é satisfeita por uma cópia válida.',
  ) {
    if (this.busy()) return false;
    this.busy.set(true);
    this.message.set('');
    try {
      const r = await call();
      if (!r.ok) throw Error(r.error.message);
      if (r.data) {
        this.state.set(r.data);
        this.message.set(success);
        return true;
      } else this.message.set('Seleção de pasta cancelada. A configuração foi preservada.');
      return false;
    } catch (e) {
      this.message.set(e instanceof Error ? e.message : 'Consulte o estado e tente novamente.');
      return false;
    } finally {
      this.busy.set(false);
      void this.refresh();
    }
  }
  async defer(reason: BackupDeferral) {
    if (!this.api) return;
    const recorded = await this.action(
      () => this.api!.adiar({ motivo: reason }),
      'Adiamento registrado. A obrigação permanece pendente.',
    );
    if (recorded) this.postponed.set(true);
  }
  ngOnDestroy() {
    this.alive = false;
    if (this.timer) clearInterval(this.timer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
  }
}
