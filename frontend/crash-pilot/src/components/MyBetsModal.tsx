import { useCallback, useEffect, useState } from 'react'
import * as betApi from '../services/betApi'
import { friendlyError } from '../services/errorMessages'
import { formatCredits, formatMultiplier } from '../utils/format'
import type { Bet } from '../services/types'

const PAGE_SIZE = 20

export function MyBetsModal({ onClose }: { onClose: () => void }) {
  const [bets, setBets] = useState<Bet[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const applyPage = useCallback((page: betApi.BetHistoryPage, append: boolean) => {
    setBets((prev) => (append ? [...prev, ...page.bets] : page.bets))
    setCursor(page.nextCursor)
    setHasMore(page.nextCursor !== null)
  }, [])

  // Initial load — no synchronous setState before the await.
  useEffect(() => {
    let active = true
    betApi
      .getBetHistory(PAGE_SIZE)
      .then((page) => active && applyPage(page, false))
      .catch((err) => active && setError(friendlyError(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [applyPage])

  const loadMore = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      applyPage(await betApi.getBetHistory(PAGE_SIZE, cursor ?? undefined), true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [applyPage, cursor])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-gray-700 bg-gray-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 p-4">
          <h2 className="text-lg font-semibold text-white">My Bets</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {bets.length === 0 && !loading && !error && (
            <p className="py-8 text-center text-sm text-gray-500">No bets yet.</p>
          )}
          <ul className="space-y-2">
            {bets.map((bet) => (
              <li
                key={bet.id}
                className="flex items-center justify-between rounded-lg bg-gray-900 px-3 py-2 text-sm"
              >
                <div className="text-gray-300">
                  <span className="text-gray-500">Slot {bet.slotId} · </span>
                  {formatCredits(bet.amount)}
                  <span className="block text-xs text-gray-500">
                    {new Date(bet.placedAt).toLocaleString()}
                  </span>
                </div>
                <BetOutcome bet={bet} />
              </li>
            ))}
          </ul>
        </div>

        {hasMore && (
          <div className="border-t border-gray-700 p-3">
            <button
              onClick={() => loadMore()}
              disabled={loading}
              className="w-full rounded-lg bg-gray-700 py-2 text-sm text-gray-200 hover:bg-gray-600 disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function BetOutcome({ bet }: { bet: Bet }) {
  if (bet.status === 'CASHED_OUT' && bet.cashOutMultiplier !== null) {
    return (
      <div className="text-right">
        <p className="font-semibold text-green-400">+{formatCredits(bet.payout)}</p>
        <p className="text-xs text-green-300">@ {formatMultiplier(bet.cashOutMultiplier)}</p>
      </div>
    )
  }
  if (bet.status === 'LOST') {
    return <p className="font-semibold text-red-400">−{formatCredits(bet.amount)}</p>
  }
  return <p className="text-xs text-gray-500">{bet.status}</p>
}
