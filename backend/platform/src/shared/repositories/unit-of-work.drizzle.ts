import { Injectable } from '@nestjs/common';
import { runInTransaction } from '@/config/postgres';
import { IUnitOfWork, TxContext } from './unit-of-work';

// Bound to the UNIT_OF_WORK token. Thin on purpose: the transaction itself lives
// in config/postgres.ts next to the connection it belongs to, and this class
// exists only so services can depend on the interface instead of the module.
@Injectable()
export class DrizzleUnitOfWork implements IUnitOfWork {
  run<T>(work: (ctx: TxContext) => Promise<T>): Promise<T> {
    return runInTransaction(work);
  }
}
