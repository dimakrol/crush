import { useEffect, useRef, useState } from 'react'

/**
 * Returns a copy of `value` that only refreshes every `intervalMs`.
 *
 * Used to keep secondary UI (cash-out button labels, "now worth" lines) from
 * re-rendering on every RAF tick of the live multiplier — the centerpiece can
 * stay at 60 Hz while small text ticks at ~10 Hz, which reads as live but stable.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const latest = useRef(value)
  const [throttled, setThrottled] = useState(value)

  // Mirror `value` into a ref so the interval callback sees the freshest value
  // without depending on it (which would re-create the interval on every change).
  useEffect(() => {
    latest.current = value
  }, [value])

  useEffect(() => {
    const id = setInterval(() => {
      setThrottled((prev) => (Object.is(prev, latest.current) ? prev : latest.current))
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return throttled
}
