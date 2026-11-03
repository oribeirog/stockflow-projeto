// Decimal text is composed into integers; no floating-point multiplication.
export function decimalInteger(
  raw: string,
  places: number,
  min: number,
  max: number,
): number | null {
  const match = raw.trim().match(/^(\d+)(?:[,.](\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > places) return null;
  const digits = match[1] + (match[2] ?? '').padEnd(places, '0');
  const value = Number(digits);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}
export function decimalText(value: number, places: number): string {
  const digits = String(value).padStart(places + 1, '0');
  return places ? digits.slice(0, -places) + ',' + digits.slice(-places) : digits;
}
