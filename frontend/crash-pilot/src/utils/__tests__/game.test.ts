import { describe, it, expect } from 'vitest'
import { calculatePayout, validateBet } from '../game'

describe('calculatePayout', () => {
  it('multiplies amount by multiplier', () => {
    expect(calculatePayout(100, 2.5)).toBe(250)
  })

  it('floors to 2 decimal places', () => {
    expect(calculatePayout(33, 1.33)).toBe(43.89)
  })
})

describe('validateBet', () => {
  it('returns null for a valid bet', () => {
    expect(validateBet(50, 1000)).toBeNull()
  })

  it('rejects zero amount', () => {
    expect(validateBet(0, 1000)).not.toBeNull()
  })

  it('rejects negative amount', () => {
    expect(validateBet(-10, 1000)).not.toBeNull()
  })

  it('rejects amount exceeding balance', () => {
    expect(validateBet(1001, 1000)).not.toBeNull()
  })

  it('allows bet equal to balance', () => {
    expect(validateBet(1000, 1000)).toBeNull()
  })

  it('rejects NaN', () => {
    expect(validateBet(NaN, 1000)).not.toBeNull()
  })

  it('rejects Infinity', () => {
    expect(validateBet(Infinity, 1000)).not.toBeNull()
  })
})
