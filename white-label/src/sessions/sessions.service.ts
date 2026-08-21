import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { env } from '@/config/env';
import { PrismaService } from '@/prisma/prisma.service';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import { WalletService } from '@/wallet/wallet.service';

// Absolute session lifetime (code-level constant). The launch token is a
// reusable session ticket valid for this window from the moment it is minted,
// so the game can re-authenticate after a page reload without a fresh launch
// from the lobby. There is no sliding extension and no explicit revocation —
// the session simply expires after this window.
const SESSION_TTL_SECONDS = 4 * 60 * 60; // 4 hours

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

  // Lobby mints a reusable launch token (absolute TTL) and returns the iframe URL.
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
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

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

  // Platform callback (HMAC). The launch token is a REUSABLE session ticket:
  // the first exchange flips the session PENDING → ACTIVE, and every later
  // exchange (e.g. after a page reload) re-reads the same ACTIVE session while
  // it is within its absolute TTL. Returns the player's identity + live balance.
  async authenticate(token: string): Promise<AuthenticateResult> {
    const now = new Date();

    const session = await this.prisma.gameSession.findUnique({
      where: { launchToken: token },
      include: { player: true },
    });

    if (!session) {
      throw new AppError(
        401,
        ErrorCode.INVALID_LAUNCH_TOKEN,
        'Unknown launch token',
      );
    }

    // Dead session — expired by TTL, or already terminated. Stamp EXPIRED once
    // so the state is durable, then reject: the game must relaunch from the lobby.
    if (
      session.status === 'EXPIRED' ||
      session.status === 'ENDED' ||
      session.expiresAt <= now
    ) {
      if (session.status !== 'EXPIRED' && session.status !== 'ENDED') {
        await this.prisma.gameSession.update({
          where: { id: session.id },
          data: { status: 'EXPIRED' },
        });
      }
      throw new AppError(
        401,
        ErrorCode.LAUNCH_TOKEN_EXPIRED,
        'Launch token expired',
      );
    }

    // First exchange consumes the ticket (PENDING → ACTIVE); reloads no-op here.
    if (session.status === 'PENDING') {
      await this.prisma.gameSession.update({
        where: { id: session.id },
        data: { status: 'ACTIVE', consumedAt: now },
      });
    }

    const balance = await this.wallet.getBalance(
      session.playerId,
      session.currency,
    );

    return {
      playerId: session.playerId,
      currency: session.currency,
      balance,
      displayName: session.player.displayName,
      sessionId: session.id,
    };
  }
}
