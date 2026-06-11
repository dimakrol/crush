import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { getDrizzle } from '@/config/postgres';
import { rounds } from '@/drizzle/schema';
import { IRoundRepository } from './round.repository.interface';
import { Round, GamePhase } from './round.types';

type RoundRow = typeof rounds.$inferSelect;

// Postgres implementation of IRoundRepository. Interchangeable with
// MongoRoundRepository behind the ROUND_REPOSITORY token. Schema/indexes are
// owned by the committed migrations (applied on boot), so there is no
// onModuleInit index creation here.
@Injectable()
export class PostgresRoundRepository implements IRoundRepository {
  async findById(id: string): Promise<Round | null> {
    const [row] = await getDrizzle()
      .select()
      .from(rounds)
      .where(eq(rounds.id, id))
      .limit(1);
    return row ? this.toRound(row) : null;
  }

  async create(crashPoint: number): Promise<Round> {
    const [row] = await getDrizzle()
      .insert(rounds)
      .values({
        phase: 'WAITING',
        crashPoint,
        startedAt: null,
        crashedAt: null,
        createdAt: new Date(),
      })
      .returning();
    return this.toRound(row);
  }

  async updatePhase(
    id: string,
    phase: GamePhase,
    extra: Partial<Round> = {},
  ): Promise<Round> {
    const { id: _id, ...rest } = extra;
    void _id;
    const [row] = await getDrizzle()
      .update(rounds)
      .set({ phase, ...rest })
      .where(eq(rounds.id, id))
      .returning();
    if (!row) throw new Error(`Round ${id} not found`);
    return this.toRound(row);
  }

  async findRecent(limit: number): Promise<Round[]> {
    const rows = await getDrizzle()
      .select()
      .from(rounds)
      .where(eq(rounds.phase, 'CRASHED'))
      .orderBy(desc(rounds.createdAt))
      .limit(limit);
    return rows.map((r) => this.toRound(r));
  }

  private toRound(row: RoundRow): Round {
    return {
      id: row.id,
      phase: row.phase as GamePhase,
      crashPoint: row.crashPoint,
      startedAt: row.startedAt,
      crashedAt: row.crashedAt,
      createdAt: row.createdAt,
    };
  }
}
