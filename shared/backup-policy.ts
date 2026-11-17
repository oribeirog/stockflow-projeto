import type { Result } from './contracts';

// Portable rules: no Electron, Angular, Node, storage or system clock dependency.
const USAGE_DAYS = 3;
export interface UsageCycle {
  count: number;
  days: string[];
  anchor?: string;
  satisfiedDay?: string;
  clockWarning: boolean;
  forced: boolean;
}
export function initialUsage(): UsageCycle {
  return { count: 0, days: [], clockWarning: false, forced: false };
}
export function recordUsage(cycle: UsageCycle, day: string): UsageCycle {
  if (cycle.anchor && day < cycle.anchor)
    return cycle.clockWarning && cycle.forced
      ? cycle
      : { ...cycle, clockWarning: true, forced: true };
  if (cycle.satisfiedDay === day) return cycle;
  if (cycle.days.includes(day)) return cycle;
  return {
    ...cycle,
    count: cycle.count + 1,
    anchor: day,
    days: [...cycle.days, day].slice(-USAGE_DAYS),
  };
}
export function satisfyUsage(day: string): UsageCycle {
  return { count: 0, days: [], anchor: day, satisfiedDay: day, clockWarning: false, forced: false };
}
export function backupDue(cycle: UsageCycle) {
  return cycle.forced || cycle.count >= USAGE_DAYS;
}
export function usageDaysRemaining(cycle: UsageCycle) {
  return backupDue(cycle) ? 0 : Math.max(0, USAGE_DAYS - cycle.count);
}
export type BackupDeferral = 'MIDIA_INDISPONIVEL' | 'OPERACAO_URGENTE';
export interface RecurringBackupStatus {
  habilitado: boolean;
  dias: number;
  restantes: number;
  devido: boolean;
  estado: 'atualizado' | 'proximo' | 'devido' | 'executando' | 'erro';
  destino?: string;
  retencao: 3 | 7 | 14 | 30;
  ultimoBackup?: { nome: string; criadoEm: string; tipo: 'manual' | 'automatico' };
  erro?: string;
  aviso?: string;
  relogioAlterado: boolean;
  adiadoEm?: string;
  historico: { em: string; evento: string; mensagem: string }[];
}
export interface RecurringBackupApi {
  estado(): Promise<Result<RecurringBackupStatus>>;
  utilizar(): Promise<Result<RecurringBackupStatus>>;
  selecionarPasta(): Promise<Result<RecurringBackupStatus | null>>;
  configurar(input: {
    habilitado: boolean;
    retencao: 3 | 7 | 14 | 30;
  }): Promise<Result<RecurringBackupStatus>>;
  executar(): Promise<Result<RecurringBackupStatus>>;
  adiar(input: { motivo: BackupDeferral }): Promise<Result<RecurringBackupStatus>>;
}
export const CANAIS_BACKUP_RECORRENTE = {
  estado: 'backup-recorrente:estado',
  utilizar: 'backup-recorrente:utilizar',
  selecionarPasta: 'backup-recorrente:selecionar-pasta',
  configurar: 'backup-recorrente:configurar',
  executar: 'backup-recorrente:executar',
  adiar: 'backup-recorrente:adiar',
} as const;
