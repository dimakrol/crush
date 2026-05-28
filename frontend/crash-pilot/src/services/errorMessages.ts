import { ApiError } from './api'

// Maps backend error codes to friendly, user-facing copy.
const MESSAGES: Record<string, string> = {
  EMAIL_ALREADY_EXISTS: 'That email is already registered. Try logging in.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  ROUND_NOT_WAITING: 'Betting is closed — wait for the next round.',
  ROUND_NOT_RUNNING: 'You can only cash out while the round is running.',
  INSUFFICIENT_BALANCE: 'Not enough balance for that bet.',
  BET_ALREADY_EXISTS: 'You already have a bet on this slot.',
  BET_NOT_FOUND: 'That bet could not be found.',
  BET_ALREADY_RESOLVED: 'That bet was already cashed out.',
  INVALID_AUTO_CASHOUT: 'Auto cash-out must be greater than 1.00.',
  UNAUTHORIZED: 'Please log in to continue.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  NETWORK_ERROR: 'Unable to reach the server. Check your connection.',
}

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? err.message
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: unknown }).code)
    return MESSAGES[code] ?? (('message' in err && String((err as { message: unknown }).message)) || 'Something went wrong.')
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}
