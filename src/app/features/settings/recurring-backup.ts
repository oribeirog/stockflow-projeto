import { Component, inject } from '@angular/core';
import { BackupPolicyClient } from '../../core/backup-policy-client';
import { Card } from '../../shared/ui/card';
import { Button } from '../../shared/ui/button';
@Component({
  selector: 'mnr-recurring-backup',
  imports: [Card, Button],
  template: ` @if (client.state(); as s) {
    <mnr-card>
      <h3 id="recurring-backup-title">Backup recorrente por dias de uso</h3>
      <p>
        Uma cópia é obrigatória a cada três dias distintos de utilização. Desabilitar a execução
        automática não desativa a obrigação nem os avisos.
      </p>
      <p id="recurring-backup-state" role="status">
        <strong>{{ label(s.estado) }}</strong> · {{ s.dias }} dia(s) desde a última cópia válida ·
        {{ s.restantes }} dia(s) restantes.
      </p>
      @if (s.devido) {
        <p class="notice">
          Seu backup de segurança está pendente. Complete uma cópia válida. Se a mídia estiver
          indisponível, você pode continuar temporariamente; a obrigação permanece visível.
        </p>
      }
      @if (s.erro) {
        <p role="alert">{{ s.erro }}</p>
      }
      @if (s.aviso) {
        <p role="status">{{ s.aviso }}</p>
      }
      @if (s.relogioAlterado) {
        <p role="status">
          O relógio retrocedeu. A obrigação foi mantida. Confira a data do Windows; somente uma
          cópia verificada estabelece um novo ciclo.
        </p>
      }
      <dl>
        <dt>Destino autorizado</dt>
        <dd id="recurring-backup-destination">{{ s.destino || 'Nenhuma pasta selecionada' }}</dd>
        <dt>Última cópia concluída</dt>
        <dd>
          {{
            s.ultimoBackup
              ? date(s.ultimoBackup.criadoEm) +
                ' · ' +
                s.ultimoBackup.nome +
                ' · ' +
                s.ultimoBackup.tipo
              : 'Ainda não registrada neste dispositivo'
          }}
        </dd>
      </dl>
      <fieldset [disabled]="client.busy() || s.estado === 'executando'">
        <label
          ><input
            id="recurring-backup-enabled"
            type="checkbox"
            [checked]="s.habilitado"
            (change)="configure($event, s.retencao)"
          />
          Execução automática habilitada</label
        >
        <label for="recurring-backup-retention">Cópias automáticas verificadas a conservar</label>
        <select
          id="recurring-backup-retention"
          [value]="s.retencao"
          (change)="retention($event, s.habilitado)"
        >
          <option value="3">3</option>
          <option value="7">7</option>
          <option value="14">14</option>
          <option value="30">30</option>
        </select>
        <div class="row">
          <mnr-button id="recurring-backup-folder" variant="secondary" (pressed)="choose()"
            >Selecionar ou alterar pasta</mnr-button
          >
          <mnr-button id="recurring-backup-run" (pressed)="run()">Realizar backup agora</mnr-button>
          @if (s.devido) {
            <mnr-button variant="secondary" (pressed)="client.defer('MIDIA_INDISPONIVEL')"
              >Continuar — mídia indisponível</mnr-button
            >
          }
        </div>
      </fieldset>
      <p>
        Recomendamos mídia ou unidade independente. Outra pasta no mesmo disco não protege contra
        falha física desse disco. A retenção só remove cópias automáticas próprias verificadas;
        nunca cópias manuais ou proteções pré-restauração.
      </p>
      @if (client.busy() || s.estado === 'executando') {
        <p role="status">Preparando ou verificando a proteção. Não há percentual estimado.</p>
      }
      @if (client.message()) {
        <p role="status" tabindex="-1" id="recurring-backup-message">{{ client.message() }}</p>
      }
      @if (s.historico.length) {
        <details>
          <summary>Histórico recente desta política</summary>
          <ul>
            @for (h of s.historico; track $index) {
              <li>{{ date(h.em) }} · {{ h.mensagem }}</li>
            }
          </ul>
        </details>
      }
    </mnr-card>
  }`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    p,
    dd,
    li {
      overflow-wrap: anywhere;
    }
    dd {
      margin: 4px 0 12px;
    }
    dt {
      color: var(--text-secondary);
    }
    fieldset {
      border: 0;
      padding: 0;
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    select {
      max-width: 100%;
    }
    input[type='checkbox'] {
      width: 20px;
      height: 20px;
      vertical-align: middle;
      margin-right: 8px;
    }
    details {
      margin-top: 16px;
    }
  `,
})
export class RecurringBackupSettings {
  readonly client = inject(BackupPolicyClient);
  label(value: string) {
    return (
      {
        atualizado: 'Atualizado',
        proximo: 'Próximo da obrigação',
        devido: 'Backup devido',
        executando: 'Executando',
        erro: 'Atenção ao backup',
      } as Record<string, string>
    )[value];
  }
  date(value: string) {
    return new Date(value).toLocaleString('pt-BR');
  }
  configure(event: Event, retencao: 3 | 7 | 14 | 30) {
    const habilitado = (event.target as HTMLInputElement).checked;
    if (this.client.api)
      void this.client.action(() => this.client.api!.configurar({ habilitado, retencao }));
  }
  retention(event: Event, habilitado: boolean) {
    const retencao = Number((event.target as HTMLSelectElement).value) as 3 | 7 | 14 | 30;
    if (this.client.api)
      void this.client.action(() => this.client.api!.configurar({ habilitado, retencao }));
  }
  async choose() {
    if (this.client.api)
      await this.client.action(
        () => this.client.api!.selecionarPasta(),
        'Pasta selecionada. Utilize Realizar backup agora para gerar uma cópia.',
      );
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('#recurring-backup-folder button')?.focus(),
    );
  }
  async run() {
    if (this.client.api)
      await this.client.action(
        () => this.client.api!.executar(),
        'Backup concluído e verificado. A contagem foi reiniciada.',
      );
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('#recurring-backup-run button')?.focus(),
    );
  }
}
