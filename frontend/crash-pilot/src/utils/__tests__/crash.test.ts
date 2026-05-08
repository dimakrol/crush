import { describe, it, expect } from 'vitest'
import { generateCrashPoint } from '../crash'

describe('generateCrashPoint', () => {
  it('always returns a value >= 1.01', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateCrashPoint()).toBeGreaterThanOrEqual(1.01)
    }
  })

  it('produces a median below 3.0 across 1000 samples', () => {
    const samples = Array.from({ length: 1000 }, generateCrashPoint).sort((a, b) => a - b)
    const median = samples[500]
    expect(median).toBeLessThan(3.0)
  })

  it('occasionally produces values above 10x', () => {
    const samples = Array.from({ length: 1000 }, generateCrashPoint)
    const highCount = samples.filter(v => v > 10).length
    expect(highCount).toBeGreaterThan(0)
  })
})
