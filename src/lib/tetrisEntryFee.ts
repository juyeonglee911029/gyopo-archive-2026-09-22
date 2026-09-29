export const DEFAULT_ENTRY_FEE = 0;
export const MIN_ENTRY_FEE = 0;
export const MAX_ENTRY_FEE = 100;

export function parseEntryFee(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= MIN_ENTRY_FEE && amount <= MAX_ENTRY_FEE ? amount : null;
}

export function shouldReserveTetrisStake(amount: number) {
  return amount > 0;
}
