export const MAX_STOCK_MONEY = 9_000_000_000_000n;
export const MAX_STOCK_QUANTITY = 1_000_000_000n;

export function custoSaida(valor: bigint, quantidade: bigint, saida: bigint): bigint {
  if (
    valor < 0n ||
    valor > MAX_STOCK_MONEY ||
    quantidade < 1n ||
    quantidade > MAX_STOCK_QUANTITY ||
    saida < 1n ||
    saida > quantidade
  )
    throw new RangeError('Saldo ou saída inválidos.');
  return saida === quantidade ? valor : (2n * valor * saida + quantidade) / (2n * quantidade);
}

export function stockNumber(value: bigint, maximum: bigint): number {
  if (value < 0n || value > maximum || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Limite de estoque excedido.');
  return Number(value);
}
