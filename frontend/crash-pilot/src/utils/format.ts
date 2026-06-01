export function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}x`
}

// Money amounts carry the session currency from the white-label (e.g. "USD").
// When no currency is known (guest spectator) we fall back to the generic label.
export function formatCredits(value: number, currency?: string | null): string {
  const amount = value.toLocaleString()
  return currency ? `${amount} ${currency}` : `${amount} credits`
}
