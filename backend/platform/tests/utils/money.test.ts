import { calculatePayout, isValidBetAmount } from '../../src/shared/utils/money'

describe('calculatePayout', () => {
  it('multiplies amount by multiplier', () => {
    expect(calculatePayout(100, 2.5)).toBe(250)
  })

  it('floors to 2 decimal places', () => {
    expect(calculatePayout(33, 1.33)).toBe(43.89)
  })
})

describe('isValidBetAmount', () => {
  it('accepts positive integers', () => expect(isValidBetAmount(50)).toBe(true))
  it('accepts 2 decimal places', () => expect(isValidBetAmount(10.25)).toBe(true))
  it('rejects zero', () => expect(isValidBetAmount(0)).toBe(false))
  it('rejects negative', () => expect(isValidBetAmount(-5)).toBe(false))
  it('rejects more than 2 decimals', () => expect(isValidBetAmount(1.123)).toBe(false))
  it('rejects NaN', () => expect(isValidBetAmount(NaN)).toBe(false))
  it('rejects Infinity', () => expect(isValidBetAmount(Infinity)).toBe(false))
  it('rejects non-numbers', () => expect(isValidBetAmount('50')).toBe(false))
})
