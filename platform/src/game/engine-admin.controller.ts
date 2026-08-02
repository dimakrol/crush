import { Body, Controller, Get, Post, UseGuards, UsePipes } from '@nestjs/common'
import { z } from 'zod'
import { getRedis } from '@/config/redis'
import { AppError } from '@/shared/errors/AppError'
import { ErrorCode } from '@/shared/errors/error-codes'
import { AdminKeyGuard } from '@/shared/guards/admin-key.guard'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { RoundEngine } from './round.engine'

const pauseSchema = z.object({ paused: z.boolean() })

type PauseDto = z.infer<typeof pauseSchema>

// Operator control over the round loop. This is the ONLY way the backoffice may
// touch the game: it reads the platform's database directly but never writes to
// it, so that every state change still goes through the engine that owns the
// bets, the outbox and the broadcasts.
@Controller('api/admin')
@UseGuards(AdminKeyGuard)
export class EngineAdminController {
  constructor(private readonly engine: RoundEngine) {}

  // Read from Redis rather than from the engine's fields: Redis is where the
  // live state already is, and it answers the same way whether this process is
  // the one running the loop or was just restarted under a standing pause.
  @Get('engine')
  async getState() {
    const redis = getRedis()
    const [phase, roundId, multiplier, paused] = await Promise.all([
      redis.get('game:phase'),
      redis.get('game:currentRound'),
      redis.get('game:currentMultiplier'),
      this.engine.isPaused(),
    ])

    return {
      data: {
        phase,
        roundId,
        multiplier: multiplier === null ? null : parseFloat(multiplier),
        paused,
      },
    }
  }

  // Graceful by design: the current round finishes and settles in full, only the
  // next one is withheld. Idempotent, so pausing an already-paused engine is a
  // successful no-op rather than an error the operator has to interpret.
  @Post('engine/pause')
  @UsePipes(new ZodValidationPipe(pauseSchema))
  async setPaused(@Body() body: PauseDto) {
    await this.engine.setPaused(body.paused)
    return this.getState()
  }

  // Ends the round now, at whatever multiplier the next 100ms tick observes.
  @Post('rounds/current/crash')
  async crashCurrent() {
    const redis = getRedis()
    const [phase, roundId] = await Promise.all([
      redis.get('game:phase'),
      redis.get('game:currentRound'),
    ])

    // Only a RUNNING round can be crashed. Refusing loudly matters more than it
    // looks: silently accepting during WAITING would arm a request that lands on
    // the next round instead of the one the operator was looking at.
    if (phase !== 'RUNNING' || !roundId) {
      throw new AppError(
        409,
        ErrorCode.VALIDATION_ERROR,
        `No running round to crash (phase is ${phase ?? 'unknown'})`,
      )
    }

    this.engine.requestForceCrash()
    return { data: { roundId } }
  }
}
