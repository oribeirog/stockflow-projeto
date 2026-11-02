import { dinheiro } from './comercial';

/** Difference of cumulative half-up amounts; never round a unit price. */
export function reversaoAcumulada(
  total: number,
  original: number,
  anterior: number,
  quantidade: number,
): number {
  for (const value of [total, original, anterior, quantidade])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Componente inválido.');
  if (total > 9_000_000_000_000 || !original || !quantidade || anterior + quantidade > original)
    throw new RangeError('Quantidade devolvida inválida.');
  const n = BigInt(original),
    t = BigInt(total);
  const rounded = (q: number) => (2n * t * BigInt(q) + n) / (2n * n);
  return dinheiro(rounded(anterior + quantidade) - rounded(anterior));
}

export function situacaoParcela(
  original: number,
  abatido: number,
  recebido: number,
  vencimento: string,
  hoje: string,
) {
  const saldoCentavos = dinheiro(BigInt(Math.max(original - abatido - recebido, 0)));
  return {
    saldoCentavos,
    recebimentoParcial: recebido > 0 && saldoCentavos > 0,
    status:
      saldoCentavos === 0
        ? 'QUITADO'
        : vencimento < hoje
          ? 'VENCIDO'
          : recebido > 0
            ? 'PARCIALMENTE_PAGO'
            : 'PENDENTE',
  } as const;
}
