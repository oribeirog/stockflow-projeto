import { Component, HostListener, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BackupPolicyClient } from '../../core/backup-policy-client';
@Component({
  selector: 'mnr-backup-notice',
  imports: [RouterLink],
  template: ` @if (client.state(); as s) {
    @if (s.devido || s.estado === 'executando') {
      <div class="backup-notice" role="status" aria-live="polite" id="backup-policy-notice">
        <span
          ><strong>{{
            s.estado === 'executando'
              ? 'Proteção de dados em andamento'
              : 'Backup de segurança pendente'
          }}</strong>
          @if (s.estado !== 'executando') {
            —
            {{
              s.erro
                ? 'Confira o destino em Configurações.'
                : 'É necessário concluir uma cópia válida.'
            }}
          }
        </span>
        <a id="backup-policy-link" routerLink="/configuracoes/backup">Realizar backup agora</a>
        @if (s.estado !== 'executando' && !client.postponed()) {
          <button type="button" [disabled]="client.busy()" (click)="defer()">
            Continuar temporariamente — operação urgente
          </button>
        } @else if (client.postponed()) {
          <span>Adiamento registrado; a obrigação permanece.</span>
        }
      </div>
    } @else if (client.protectedNotice()) {
      <div class="backup-notice" role="status">
        Backup concluído e verificado. Seus dados foram incluídos na cópia de segurança.
      </div>
    }
  }`,
  styles: `
    :host {
      display: block;
      flex: 0 0 auto;
      min-width: 0;
    }
    .backup-notice {
      display: flex;
      gap: 8px 16px;
      flex-wrap: wrap;
      align-items: center;
      padding: 8px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--control-border);
      font-size: var(--text-small);
      overflow-wrap: anywhere;
    }
    button {
      color: var(--text);
      background: var(--surface-raised);
      border: 1px solid var(--control-border);
      border-radius: var(--radius-control);
      padding: 6px 10px;
      white-space: normal;
    }
  `,
})
export class BackupNotice {
  readonly client = inject(BackupPolicyClient);
  async defer() {
    await this.client.defer('OPERACAO_URGENTE');
    if (this.client.postponed())
      requestAnimationFrame(() => document.getElementById('backup-policy-link')?.focus());
  }
  @HostListener('document:pointerdown') pointer() {
    this.use();
  }
  @HostListener('document:keydown') keyboard() {
    this.use();
  }
  @HostListener('window:focus') focus() {
    this.use();
  }
  private use() {
    if (document.visibilityState === 'visible') void this.client.refresh(true);
  }
}
