import { generateCrashPoint } from '../utils/crash'
import type { Round } from '../types/game'

// TODO: Replace with backend call — fetch the crash point for the upcoming round from the server.
export async function fetchRoundResult(): Promise<number> {
  return generateCrashPoint()
}

// TODO: Replace with backend call — submit cashout transaction and return server-confirmed payout.
export async function submitCashOut(_multiplier: number, amount: number): Promise<number> {
  return amount
}

// TODO: Replace with backend call — fetch paginated round history from the server.
export async function fetchRoundHistory(): Promise<Round[]> {
  return []
}
