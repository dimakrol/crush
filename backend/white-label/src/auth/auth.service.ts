import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { PrismaService } from '@/prisma/prisma.service';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import { LoginDto } from './auth.dto';

export interface LobbyJwtPayload {
  sub: string;
  displayName: string;
}

export interface LoginResult {
  token: string;
  player: {
    id: string;
    displayName: string;
    currency: string;
    balance: number;
  };
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const player = await this.prisma.player.findUnique({
      where: { username: dto.username },
      include: { wallets: true },
    });
    if (!player) {
      throw new AppError(
        401,
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid username or password',
      );
    }

    const ok = await bcrypt.compare(dto.password, player.passwordHash);
    if (!ok) {
      throw new AppError(
        401,
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid username or password',
      );
    }

    const payload: LobbyJwtPayload = {
      sub: player.id,
      displayName: player.displayName,
    };
    const token = jwt.sign(payload, env.LOBBY_JWT_SECRET, {
      expiresIn: env.LOBBY_JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

    const wallet = player.wallets[0];
    return {
      token,
      player: {
        id: player.id,
        displayName: player.displayName,
        currency: wallet?.currency ?? 'USD',
        balance: Number(wallet?.balance ?? 0n),
      },
    };
  }
}
