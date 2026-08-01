import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { env } from '@/config/env';
import { PrismaService } from '@/prisma/prisma.service';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import { WalletService } from '@/wallet/wallet.service';

export interface LaunchResult {
  launchToken: string;
  gameUrl: string;
  expiresAt: Date;
}

export interface AuthenticateResult {
  playerId: string;
  currency: string;
  balance: number;
  displayName: string;
  sessionId: string;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  // Lobby mints a single-use launch token (short TTL) and returns the iframe URL.
  async launch(playerId: string, gameId: string): Promise<LaunchResult> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { wallets: true },
    });
    if (!player) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Player not found');
    }

    const currency = player.wallets[0]?.currency ?? 'USD';
    const launchToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + env.LAUNCH_TOKEN_TTL_SECONDS * 1000,
    );

    await this.prisma.gameSession.create({
      data: {
        launchToken,
        playerId,
        currency,
        gameId,
        status: 'PENDING',
        expiresAt,
      },
    });

    const gameUrl = `${env.GAME_FRONTEND_URL}/?token=${launchToken}&currency=${currency}&lang=en`;
    return { launchToken, gameUrl, expiresAt };
  }

  // Platform callback (HMAC). Consumes the launch token single-use and returns
  // the player's identity + live balance, flipping the session to ACTIVE.
  async authenticate(token: string): Promise<AuthenticateResult> {
    const now = new Date();

    const consumed = await this.prisma.gameSession.updateMany({
      where: { launchToken: token, status: 'PENDING', expiresAt: { gt: now } },
      data: { status: 'ACTIVE', consumedAt: now },
    });

    if (consumed.count === 0) {
      const session = await this.prisma.gameSession.findUnique({
        where: { launchToken: token },
      });
      if (!session) {
        throw new AppError(
          401,
          ErrorCode.INVALID_LAUNCH_TOKEN,
          'Unknown launch token',
        );
      }
      if (session.status === 'PENDING' && session.expiresAt <= now) {
        await this.prisma.gameSession.update({
          where: { id: session.id },
          data: { status: 'EXPIRED' },
        });
        throw new AppError(
          401,
          ErrorCode.LAUNCH_TOKEN_EXPIRED,
          'Launch token expired',
        );
      }
      throw new AppError(
        401,
        ErrorCode.LAUNCH_TOKEN_ALREADY_USED,
        'Launch token already used',
      );
    }

    const session = await this.prisma.gameSession.findUnique({
      where: { launchToken: token },
      include: { player: true },
    });
    // Guaranteed present: we just consumed it in the same request.
    const balance = await this.wallet.getBalance(
      session!.playerId,
      session!.currency,
    );

    return {
      playerId: session!.playerId,
      currency: session!.currency,
      balance,
      displayName: session!.player.displayName,
      sessionId: session!.id,
    };
  }
}
