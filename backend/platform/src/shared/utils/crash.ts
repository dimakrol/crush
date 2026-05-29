// Demo-only crash generation.
// TODO: Replace with provably fair or regulated backend logic before any real-money use.
export function generateCrashPoint(): number {
  return Math.max(1.01, 0.99 / Math.random());
}
