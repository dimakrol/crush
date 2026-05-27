import { generateCrashPoint } from '../../src/shared/utils/crash'

describe('generateCrashPoint', () => {
  it('always returns a value >= 1.01', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateCrashPoint()).toBeGreaterThanOrEqual(1.01)
    }
  })

  it('produces a median below 3.0 across 1000 samples', () => {
    const samples = Array.from({ length: 1000 }, generateCrashPoint).sort((a, b) => a - b)
    expect(samples[500]).toBeLessThan(3.0)
  })

  it('occasionally produces values above 10x', () => {
    const samples = Array.from({ length: 1000 }, generateCrashPoint)
    expect(samples.some((v) => v > 10)).toBe(true)
  })
})
