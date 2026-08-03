// Shapes the API actually returns, and the vocabularies the filters accept.
//
// These duplicate the platform's enums on purpose: the server validates every
// filter value against its own copy of the schema and answers 400 for anything
// outside it, so a value that drifts here shows up as a rejected request rather
// than as a list that is quietly wrong.

export const ROUND_PHASES = ['WAITING', 'RUNNING', 'CRASHED'] as const;

export const BET_STATUSES = [
  'PENDING_STAKE',
  'PLACED',
  'CASHED_OUT',
  'LOST',
  'CANCELED',
  'REJECTED',
  'SETTLEMENT_PENDING',
] as const;

export const WALLET_OP_KINDS = ['DEBIT', 'CREDIT', 'ROLLBACK'] as const;
export const WALLET_OP_STATES = ['PENDING', 'CONFIRMED', 'FAILED'] as const;

export const ROLES = ['viewer', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
}

export interface EngineState {
  phase: (typeof ROUND_PHASES)[number] | null;
  roundId: string | null;
  multiplier: number | null;
  paused: boolean;
}

export interface DashboardCounters {
  walletOpsFailed: number;
  walletOpsStuckPending: number;
  betsSettlementPending: number;
  betsStuckPendingStake: number;
}

export interface DashboardData {
  // null when the platform could not be reached; engineError says why. The
  // counters come from the database and are still there in that case.
  engine: EngineState | null;
  engineError: string | null;
  counters: DashboardCounters;
  stuckAfterMinutes: number;
}

export interface RetryResult {
  retried: number;
  txRefs: string[];
}

// `choices` for react-admin's SelectInput, which wants objects.
export function choices<T extends string>(
  values: readonly T[],
): { id: T; name: T }[] {
  return values.map((id) => ({ id, name: id }));
}
