import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { forwardRef, Inject } from '@nestjs/common'
import { env } from '../config/env'
import { AppError } from '../shared/errors/AppError'
import { ErrorCode } from '../shared/errors/error-codes'
import { BetService } from '../modules/bets/bet.service'
import { BetSlotId } from '../modules/bets/bet.types'
import { logger } from '../shared/utils/logger'

interface AuthSocket extends Socket {
  userId: string
}

@WebSocketGateway({ cors: { origin: env.CORS_ORIGIN } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server

  constructor(
    @Inject(forwardRef(() => BetService))
    private readonly betService: BetService,
  ) {}

  async handleConnection(socket: AuthSocket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) {
      socket.emit('error', { code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' })
      socket.disconnect()
      return
    }
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string }
      socket.userId = payload.sub
      await socket.join(socket.userId)
      logger.info('Socket connected', { userId: socket.userId })
    } catch {
      socket.emit('error', { code: ErrorCode.UNAUTHORIZED, message: 'Invalid token' })
      socket.disconnect()
    }
  }

  handleDisconnect(socket: AuthSocket): void {
    logger.info('Socket disconnected', { userId: socket.userId })
  }

  emitToAll(event: string, payload: unknown): void {
    this.server.emit(event, payload)
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userId).emit(event, payload)
  }

  @SubscribeMessage('bet:place')
  async handlePlaceBet(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() data: { slotId: BetSlotId; amount: number; autoCashOut?: number | null },
  ): Promise<void> {
    try {
      const result = await this.betService.placeBet(socket.userId, data.slotId, data.amount, data.autoCashOut ?? null)
      socket.emit('bet:placed', result)
    } catch (err) {
      const e = err as AppError
      socket.emit('error', { code: e.code ?? ErrorCode.INTERNAL_SERVER_ERROR, message: e.message })
    }
  }

  @SubscribeMessage('bet:cashout')
  async handleCashOut(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() data: { betId: string },
  ): Promise<void> {
    try {
      const result = await this.betService.cashOut(socket.userId, data.betId)
      socket.emit('bet:cashedOut', result)
    } catch (err) {
      const e = err as AppError
      socket.emit('error', { code: e.code ?? ErrorCode.INTERNAL_SERVER_ERROR, message: e.message })
    }
  }
}
