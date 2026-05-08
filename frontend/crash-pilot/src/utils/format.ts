export function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}x`
}

export function formatCredits(value: number): string {
  return `${value.toLocaleString()} credits`
}
