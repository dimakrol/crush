export function calculatePayout(amount: number, multiplier: number): number {
  return Math.floor(amount * multiplier * 100) / 100;
}

export function isValidBetAmount(amount: unknown): boolean {
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0)
    return false;
  // Allow at most 2 decimal places. Comparing `amount * 100` against its
  // rounding would reject legitimate amounts whose scaled product is inexact
  // in float64 (4.44 * 100 === 444.00000000000006); rounding the value itself
  // and comparing back is exact for every double.
  return Number(amount.toFixed(2)) === amount;
}
