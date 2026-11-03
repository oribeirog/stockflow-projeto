// Pure document rules shared by the renderer and the cadastral boundary.
function digit(base: string, weights: number[]): string {
  const sum = [...base].reduce(
    (acc, char, index) => acc + (char.charCodeAt(0) - 48) * weights[index],
    0,
  );
  const remainder = sum % 11;
  return String(remainder < 2 ? 0 : 11 - remainder);
}

export function documentoCanonico(raw: string | null, type: 'PF' | 'PJ' | null): string | null {
  if (raw === null) return null;
  if (!type) throw new Error('tipoPessoa');
  const normalized = raw.toUpperCase().replace(/[.\/\-\s]/g, '');
  if (/^(.)\1+$/.test(normalized)) throw new Error('documento');
  if (type === 'PF') {
    if (!/^\d{11}$/.test(normalized)) throw new Error('CPF');
    const base = normalized.slice(0, 9);
    const first = digit(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    if (normalized !== base + first + digit(base + first, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]))
      throw new Error('CPF');
  } else {
    if (!/^[A-Z0-9]{12}\d{2}$/.test(normalized)) throw new Error('CNPJ');
    const base = normalized.slice(0, 12);
    const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    if (normalized !== base + first + digit(base + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]))
      throw new Error('CNPJ');
  }
  return normalized;
}
