export function calculatePayout(amount: number, multiplier: number): number {
  return Math.floor(amount * multiplier * 100) / 100
}

export function isValidBetAmount(amount: unknown): boolean {
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return false
  // Allow at most 2 decimal places
  return Math.round(amount * 100) === amount * 100
}
