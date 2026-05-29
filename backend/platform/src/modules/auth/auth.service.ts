import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../users/user.repository.interface';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    private readonly walletService: WalletService,
  ) {}

  async register(email: string, password: string) {
    const existing = await this.userRepo.findByEmail(email);
    if (existing)
      throw new AppError(
        409,
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'Email already in use',
      );

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.userRepo.create({ email, passwordHash });
    await this.walletService.createWallet(user.id);

    const accessToken = this.signToken(user.id);
    return { user: { id: user.id, email: user.email }, accessToken };
  }

  async login(email: string, password: string) {
    const user = await this.userRepo.findByEmail(email);
    const valid = user
      ? await bcrypt.compare(password, user.passwordHash)
      : false;
    if (!user || !valid) {
      throw new AppError(
        401,
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password',
      );
    }
    const accessToken = this.signToken(user.id);
    return { user: { id: user.id, email: user.email }, accessToken };
  }

  async me(userId: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new AppError(404, ErrorCode.NOT_FOUND, 'User not found');
    const balance = await this.walletService.getBalance(userId);
    return { user: { id: user.id, email: user.email }, balance };
  }

  private signToken(userId: string): string {
    return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
  }
}
