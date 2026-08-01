import { IBaseRepository } from '@/shared/repositories/base.repository';
import { Round, GamePhase } from './round.types';

export const ROUND_REPOSITORY = 'ROUND_REPOSITORY';

export interface IRoundRepository extends IBaseRepository<Round> {
  create(crashPoint: number): Promise<Round>;
  updatePhase(
    id: string,
    phase: GamePhase,
    extra?: Partial<Round>,
  ): Promise<Round>;
  findRecent(limit: number): Promise<Round[]>;
}
