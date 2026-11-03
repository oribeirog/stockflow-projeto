import type { CodigoErroCadastro } from '../../shared/catalogos';
import { documentoCanonico } from '../../shared/pessoa-values';

export const MAX_MONEY = 9_000_000_000_000;
export const MAX_QUANTITY = 1_000_000_000;
export class CadastroError extends Error {
  constructor(
    public readonly code: CodigoErroCadastro,
    message: string,
  ) {
    super(message);
  }
}
export function invalid(field: string): never {
  throw new CadastroError('VALIDATION', `Campo inválido: ${field}.`);
}
export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid('objeto');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) invalid('campo inesperado');
  return result;
}
export function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') invalid(field);
  const normalized = value.trim().normalize('NFC');
  if (
    !normalized ||
    normalized.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  )
    invalid(field);
  return normalized;
}
export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
    return null;
  return text(value, field, max);
}
export function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    invalid(field);
  return value;
}
export function identifier(value: unknown): number {
  return integer(value, 'id', 1, Number.MAX_SAFE_INTEGER);
}
export function active(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid('ativo');
  return value;
}
export function nameKey(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function documentNumber(value: unknown, type: 'PF' | 'PJ' | null): string | null {
  const raw = optionalText(value, 'documento', 40);
  try {
    return documentoCanonico(raw, type);
  } catch (error) {
    invalid(error instanceof Error ? error.message : 'documento');
  }
}

// Canonical serialization for normalized commands: object key order is irrelevant.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
