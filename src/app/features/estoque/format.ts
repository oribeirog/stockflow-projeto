// Formatting only: accepts exact cents, including aggregate strings above MAX_SAFE_INTEGER.
export function reais(cents: number | string): string {
  const raw = String(cents);
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(3, '0');
  return `${negative ? '−' : ''}R$ ${digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${digits.slice(-2)}`;
}
export function hojeLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
