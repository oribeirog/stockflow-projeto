import type { PeriodoRelatorio } from '../../../../shared/relatorios-ipc';
export function dateLabel(iso: string): string {
  return iso.length === 7
    ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
export function instantLabel(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}
export function quantityLabel(value: number): string {
  return value.toLocaleString('pt-BR');
}
export function percentLabel(value: number | null): string {
  if (value === null) return 'Não aplicável';
  const digits = String(Math.abs(value)).padStart(3, '0');
  return `${value < 0 ? '−' : ''}${digits.slice(0, -2)},${digits.slice(-2)}%`;
}
function localIso(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function presetPeriod(preset: string, now = new Date()): PeriodoRelatorio {
  const start = new Date(now);
  if (preset === 'month') start.setDate(1);
  else start.setDate(start.getDate() - (preset === '90' ? 89 : 29));
  return { dataInicio: localIso(start), dataFim: localIso(now) };
}
// UTC is only calendar arithmetic for validation; business date strings are never converted.
export function validPeriod(period: PeriodoRelatorio): boolean {
  const parse = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN;
    const n = Date.parse(iso + 'T00:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === iso ? n : NaN;
  };
  const start = parse(period.dataInicio),
    end = parse(period.dataFim);
  return (
    Number.isFinite(start) && Number.isFinite(end) && end >= start && (end - start) / 86400000 < 366
  );
}
