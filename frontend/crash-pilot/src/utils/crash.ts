// This is demo-only frontend logic.
// TODO: Replace generateCrashPoint() with backend-provided round result.
export function generateCrashPoint(): number {
  return Math.max(1.01, 0.99 / Math.random())
}
