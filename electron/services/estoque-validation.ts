import type { CodigoErroEstoque } from '../../shared/estoque';
import { record, text, integer, identifier, CadastroError } from './catalog-validation';

export class EstoqueError extends Error {
  constructor(
    public readonly code: CodigoErroEstoque,
    message: string,
  ) {
    super(message);
  }
}
export function stockValidation<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof CadastroError) throw new EstoqueError('VALIDATION', error.message);
    throw error;
  }
}
export { record, text, integer, identifier };
export function effectiveDate(value: unknown, now: Date): string {
  const date = text(value, 'dataEfetiva', 10);
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
    date > localToday
  )
    throw new EstoqueError('VALIDATION', 'Data efetiva inválida ou futura.');
  return date;
}
