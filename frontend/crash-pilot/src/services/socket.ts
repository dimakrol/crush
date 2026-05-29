// Singleton Socket.IO connection to the platform gateway.
//
// Connection model (per integration PRD):
// - Connect once at app start. A guest (no token) receives round:* broadcasts
//   only; a logged-in socket also joins its userId room for private events.
// - On login mid-session, emit `authenticate` { token } so the server joins the
//   room without a reconnect.
// - On logout, reconnect fresh so the server drops the userId association.

import { io, Socket } from 'socket.io-client'
import { getToken, onTokenChange } from './token'
import type {
  RoundWaitingEvent,
  RoundCountdownEvent,
  RoundStartedEvent,
  RoundMultiplierEvent,
  RoundCrashedEvent,
  BetCashedOutEvent,
  BetLostEvent,
  BetQueuedEvent,
  BetQueueCanceledEvent,
  BetQueuePlacedEvent,
  BetQueueDroppedEvent,
  WalletUpdatedEvent,
  SocketErrorEvent,
  BetSlotId,
} from './types'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000'

// Maps every server→client event to its payload type, for typed on/off.
export interface ServerEvents {
  'round:waiting': RoundWaitingEvent
  'round:countdown': RoundCountdownEvent
  'round:started': RoundStartedEvent
  'round:multiplier': RoundMultiplierEvent
  'round:crashed': RoundCrashedEvent
  'bet:placed': BetCashedOutEvent // { result } shape from socket bet:place; bet field present
  'bet:cashedOut': BetCashedOutEvent
  'bet:lost': BetLostEvent
  'bet:queued': BetQueuedEvent
  'bet:queueCanceled': BetQueueCanceledEvent
  'bet:queuePlaced': BetQueuePlacedEvent
  'bet:queueDropped': BetQueueDroppedEvent
  'session:superseded': void
  'wallet:updated': WalletUpdatedEvent
  error: SocketErrorEvent
}

let socket: Socket | null = null

export function getSocket(): Socket {
  if (socket) return socket

  socket = io(SOCKET_URL, {
    auth: { token: getToken() ?? undefined },
    autoConnect: true,
    transports: ['websocket'],
  })

  // React to login/logout after the socket already exists.
  onTokenChange((token) => {
    if (!socket) return
    if (token) {
      // Login mid-session: join the userId room live.
      socket.emit('authenticate', { token })
    } else {
      // Logout: reconnect as a guest so the server drops the userId room.
      socket.auth = { token: undefined }
      socket.disconnect().connect()
    }
  })

  return socket
}

export function on<E extends keyof ServerEvents>(
  event: E,
  handler: (payload: ServerEvents[E]) => void,
): () => void {
  const s = getSocket()
  s.on(event as string, handler as (...args: unknown[]) => void)
  return () => s.off(event as string, handler as (...args: unknown[]) => void)
}

export function emitCashout(betId: string): void {
  getSocket().emit('bet:cashout', { betId })
}

export function emitQueueNext(slotId: BetSlotId, amount: number, autoCashOut: number | null): void {
  getSocket().emit('bet:queueNext', { slotId, amount, autoCashOut })
}

export function emitCancelNext(slotId: BetSlotId): void {
  getSocket().emit('bet:cancelNext', { slotId })
}
