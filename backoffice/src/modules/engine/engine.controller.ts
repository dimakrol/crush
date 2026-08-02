import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../../shared/auth/auth.decorators';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { PlatformAdminClient } from '../platform/platform-admin.client';

const pauseSchema = z.object({ paused: z.boolean() });
type PauseDto = z.infer<typeof pauseSchema>;

export interface EngineState {
  phase: string | null;
  roundId: string | null;
  multiplier: number | null;
  paused: boolean;
}

// Two buttons, both of them thin: the decisions live in the platform's engine,
// and duplicating any of that judgement here would give the console a second
// opinion about the state of the game.
@Controller('api/engine')
@Roles('operator', 'admin')
export class EngineController {
  constructor(private readonly platform: PlatformAdminClient) {}

  // Graceful: the running round finishes and settles, only the next one is
  // withheld. Idempotent, so a nervous double-click is a no-op.
  @Post('pause')
  @HttpCode(200)
  async pause(@Body(new ZodValidationPipe(pauseSchema)) body: PauseDto) {
    const data = await this.platform.post<EngineState>(
      '/api/admin/engine/pause',
      body,
    );
    return { data };
  }

  // Ends the current round at whatever multiplier the platform's next tick sees.
  // A 409 from the platform ("no running round to crash") is passed straight
  // through — the operator needs to read that, not a generic failure.
  @Post('force-crash')
  @HttpCode(200)
  async forceCrash() {
    const data = await this.platform.post<{ roundId: string }>(
      '/api/admin/rounds/current/crash',
    );
    return { data };
  }
}
