export type GamePhase = 'WAITING' | 'RUNNING' | 'CRASHED';

export interface Round {
  id: string;
  phase: GamePhase;
  crashPoint: number;
  startedAt: Date | null;
  crashedAt: Date | null;
  // Non-null when an operator ended the round by hand; see drizzle/schema.ts.
  forcedAt: Date | null;
  createdAt: Date;
}
