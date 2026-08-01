export type GamePhase = 'WAITING' | 'RUNNING' | 'CRASHED';

export interface Round {
  id: string;
  phase: GamePhase;
  crashPoint: number;
  startedAt: Date | null;
  crashedAt: Date | null;
  createdAt: Date;
}
