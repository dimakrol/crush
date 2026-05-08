export function calculatePayout(amount: number, multiplier: number): number {
  return Math.floor(amount * multiplier * 100) / 100
}

export function validateBet(amount: number, balance: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'Bet amount must be greater than 0'
  if (amount > balance) return 'Amount exceeds balance'
  return null
}
