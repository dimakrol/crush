export const UNIT_OF_WORK = 'UNIT_OF_WORK';

// Opaque handle to an open database transaction. A service passes it to several
// repository calls to make them commit together, without ever learning what is
// inside — that stays a repository concern, exactly like the rest of the ORM.
export interface TxContext {
  readonly _executor: unknown;
}

// Deliberately minimal: no savepoints, no isolation knobs, no nesting. Every
// transaction in this service is a two-or-three-statement unit of work that
// pairs a domain state change with the money op that justifies it.
export interface IUnitOfWork {
  run<T>(work: (ctx: TxContext) => Promise<T>): Promise<T>;
}
