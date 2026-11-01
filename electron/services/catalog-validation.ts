import type { CodigoErroCadastro } from '../../shared/catalogos';

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

function digit(base: string, weights: number[]): string {
  const sum = [...base].reduce(
    (acc, char, index) => acc + (char.charCodeAt(0) - 48) * weights[index],
    0,
  );
  const remainder = sum % 11;
  return String(remainder < 2 ? 0 : 11 - remainder);
}
export function documentNumber(value: unknown, type: 'PF' | 'PJ' | null): string | null {
  const raw = optionalText(value, 'documento', 40);
  if (raw === null) return null;
  if (!type) invalid('tipoPessoa');
  const normalized = raw.toUpperCase().replace(/[.\/\-\s]/g, '');
  if (/^(.)\1+$/.test(normalized)) invalid('documento');
  if (type === 'PF') {
    if (!/^\d{11}$/.test(normalized)) invalid('CPF');
    const base = normalized.slice(0, 9);
    const first = digit(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    if (normalized !== base + first + digit(base + first, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]))
      invalid('CPF');
  } else {
    if (!/^[A-Z0-9]{12}\d{2}$/.test(normalized)) invalid('CNPJ');
    const base = normalized.slice(0, 12);
    const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    if (normalized !== base + first + digit(base + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]))
      invalid('CNPJ');
  }
  return normalized;
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
