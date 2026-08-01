import { calculatePayout, isValidBetAmount } from '@/shared/utils/money'

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
  // amount * 100 is inexact for these: 4.44 * 100 === 444.00000000000006
  it.each([4.44, 0.07, 8.7, 0.29, 0.55])(
    'accepts %p, whose scaled product is inexact in float64',
    (amount) => expect(isValidBetAmount(amount)).toBe(true),
  )
  it('rejects zero', () => expect(isValidBetAmount(0)).toBe(false))
  it('rejects negative', () => expect(isValidBetAmount(-5)).toBe(false))
  it('rejects more than 2 decimals', () => expect(isValidBetAmount(1.123)).toBe(false))
  it('rejects a half-cent', () => expect(isValidBetAmount(1.005)).toBe(false))
  it('rejects NaN', () => expect(isValidBetAmount(NaN)).toBe(false))
  it('rejects Infinity', () => expect(isValidBetAmount(Infinity)).toBe(false))
  it('rejects non-numbers', () => expect(isValidBetAmount('50')).toBe(false))
})
