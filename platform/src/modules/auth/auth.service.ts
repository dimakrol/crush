import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { operatorPost } from '@/shared/whitelabel/operator.client';
import { WalletService } from '../wallet/wallet.service';

// The white-label `authenticate` response. `balance` is in integer minor units
// (operator ledger) and is converted to the platform's decimal currency here.
interface AuthenticateResponse {
  playerId: string;
  currency: string;
  balance: number;
  displayName: string;
  sessionId: string;
}

export interface PlayerView {
  id: string;
  displayName: string;
  currency: string;
  balance: number;
}

@Injectable()
export class AuthService {
  constructor(private readonly walletService: WalletService) {}

  // Exchange a single-use launch token for a platform session. The white-label
  // consumes the token and returns identity + balance; we mint our own JWT that
  // carries the playerId, the session's currency and the operator sessionId.
  async launch(
    token: string,
  ): Promise<{ accessToken: string; player: PlayerView }> {
    const result = await operatorPost<AuthenticateResponse>(
      '/wallet/authenticate',
      { token },
    );

    const accessToken = jwt.sign(
      {
        sub: result.playerId,
        currency: result.currency,
        sessionId: result.sessionId,
        displayName: result.displayName,
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );

    return {
      accessToken,
      player: {
        id: result.playerId,
        displayName: result.displayName,
        currency: result.currency,
        balance: result.balance / 100,
      },
    };
  }

  // Live identity + balance for the authenticated session. Identity fields ride
  // on the platform JWT; balance is fetched fresh from the white-label.
  async me(
    userId: string,
    currency: string,
    displayName: string,
  ): Promise<{ player: PlayerView }> {
    const balance = await this.walletService.getBalance(userId, currency);
    return {
      player: { id: userId, displayName, currency, balance },
    };
  }
}
