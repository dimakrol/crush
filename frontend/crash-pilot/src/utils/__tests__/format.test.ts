import { describe, it, expect } from 'vitest'
import { formatMultiplier } from '../format'

describe('formatMultiplier', () => {
  it('formats integer as 2 decimals', () => {
    expect(formatMultiplier(1)).toBe('1.00x')
  })

  it('formats with 2 decimal places', () => {
    expect(formatMultiplier(2.5)).toBe('2.50x')
  })

  it('truncates extra decimals', () => {
    expect(formatMultiplier(10.123)).toBe('10.12x')
  })

  it('rounds the last decimal', () => {
    expect(formatMultiplier(1.456)).toBe('1.46x')
  })
})
