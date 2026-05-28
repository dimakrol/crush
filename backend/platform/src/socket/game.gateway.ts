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
  userId?: string
}

@WebSocketGateway({ cors: { origin: env.CORS_ORIGIN } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server

  constructor(
    @Inject(forwardRef(() => BetService))
    private readonly betService: BetService,
  ) {}

  // Guests may connect without a token to spectate round:* broadcasts. A valid
  // token joins the userId room so the socket also receives private bet/wallet events.
  async handleConnection(socket: AuthSocket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined
    if (token) await this.authenticateSocket(socket, token)
    else logger.info('Guest socket connected', { socketId: socket.id })
  }

  handleDisconnect(socket: AuthSocket): void {
    logger.info('Socket disconnected', { userId: socket.userId, socketId: socket.id })
  }

  // Verify a token and join the userId room. Invalid tokens leave the socket as a
  // guest (it stays connected) rather than disconnecting it.
  private async authenticateSocket(socket: AuthSocket, token: string): Promise<boolean> {
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string }
      socket.userId = payload.sub
      await socket.join(socket.userId)
      logger.info('Socket authenticated', { userId: socket.userId, socketId: socket.id })
      return true
    } catch {
      socket.emit('error', { code: ErrorCode.UNAUTHORIZED, message: 'Invalid token' })
      return false
    }
  }

  // Mid-session login: authenticate an already-connected guest socket without a reconnect.
  @SubscribeMessage('authenticate')
  async handleAuthenticate(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() data: { token: string },
  ): Promise<void> {
    const ok = await this.authenticateSocket(socket, data?.token ?? '')
    if (ok) socket.emit('authenticated', { userId: socket.userId })
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
    if (!socket.userId) {
      socket.emit('error', { code: ErrorCode.UNAUTHORIZED, message: 'Log in to place a bet' })
      return
    }
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
    if (!socket.userId) {
      socket.emit('error', { code: ErrorCode.UNAUTHORIZED, message: 'Log in to cash out' })
      return
    }
    try {
      const { bet, balance } = await this.betService.cashOut(socket.userId, data.betId)
      // Mirror the auto-cashout path in RoundEngine: broadcast to the user room
      // so every connected session of that user (and the requester) sees both events.
      this.emitToUser(socket.userId, 'bet:cashedOut', { bet })
      this.emitToUser(socket.userId, 'wallet:updated', { balance })
    } catch (err) {
      const e = err as AppError
      socket.emit('error', { code: e.code ?? ErrorCode.INTERNAL_SERVER_ERROR, message: e.message })
    }
  }
}
