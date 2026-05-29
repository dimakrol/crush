import { Inject, Injectable } from '@nestjs/common';
import {
  ROUND_REPOSITORY,
  IRoundRepository,
} from '../rounds/round.repository.interface';

@Injectable()
export class HistoryService {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly roundRepo: IRoundRepository,
  ) {}

  async getRecentRounds(limit: number) {
    const rounds = await this.roundRepo.findRecent(limit);
    return rounds.map((r) => ({
      id: r.id,
      crashPoint: r.crashPoint,
      startedAt: r.startedAt,
      crashedAt: r.crashedAt,
    }));
  }
}
