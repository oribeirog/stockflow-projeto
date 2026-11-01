import type { Desconto } from '../../shared/comercial';
import { MAX_STOCK_MONEY, stockNumber } from './custeio';

export const dinheiro = (value: bigint) => stockNumber(value, MAX_STOCK_MONEY);
export const somar = (values: number[]) => dinheiro(values.reduce((sum, n) => sum + BigInt(n), 0n));
function validateMoney(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) > MAX_STOCK_MONEY)
    throw new RangeError('Valor monetário inválido.');
}

export function descontoCentavos(base: number, desconto?: Desconto): number {
  validateMoney(base);
  if (!desconto) return 0;
  validateMoney(desconto.valor);
  if (
    (desconto.tipo !== 'CENTAVOS' && desconto.tipo !== 'PONTOS_BASE') ||
    (desconto.tipo === 'PONTOS_BASE' && desconto.valor > 10000)
  )
    throw new RangeError('Desconto inválido.');
  const valor = BigInt(desconto.valor);
  const result =
    desconto.tipo === 'CENTAVOS' ? valor : (BigInt(base) * valor * 2n + 10000n) / 20000n;
  if (result < 0n || result > BigInt(base)) throw new RangeError('Desconto excede a base.');
  return dinheiro(result);
}

// Exact largest remainder allocation; array order is the persisted item sequence.
export function ratear(total: number, bases: number[]): number[] {
  validateMoney(total);
  bases.forEach(validateMoney);
  const denominator = bases.reduce((sum, n) => sum + BigInt(n), 0n);
  if (denominator === 0n) {
    if (total !== 0) throw new RangeError('Rateio sem base.');
    return bases.map(() => 0);
  }
  const fractions = bases.map((n, index) => {
    const numerator = BigInt(n) * BigInt(total);
    return { index, value: numerator / denominator, remainder: numerator % denominator };
  });
  const missing = BigInt(total) - fractions.reduce((sum, part) => sum + part.value, 0n);
  const ranked = [...fractions].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (let i = 0; i < Number(missing); i++) ranked[i].value++;
  return fractions.map((part) => dinheiro(part.value));
}

export function dividirParcelas(totalCentavos: number, quantidade: number): number[] {
  if (
    !Number.isSafeInteger(totalCentavos) ||
    totalCentavos < 1 ||
    BigInt(totalCentavos) > MAX_STOCK_MONEY ||
    !Number.isSafeInteger(quantidade) ||
    quantidade < 1 ||
    quantidade > 1000 ||
    quantidade > totalCentavos
  )
    throw new RangeError('Divisão de parcelas inválida.');
  const total = BigInt(totalCentavos),
    count = BigInt(quantidade);
  return Array.from({ length: quantidade }, (_, i) =>
    Number(total / count + (BigInt(i) < total % count ? 1n : 0n)),
  );
}
