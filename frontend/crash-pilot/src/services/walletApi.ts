import { apiRequest } from './api'

export async function getBalance(): Promise<number> {
  const res = await apiRequest<{ balance: number }>('/api/wallet')
  return res.data.balance
}

export async function resetBalance(): Promise<number> {
  const res = await apiRequest<{ balance: number }>('/api/wallet/reset', { method: 'POST' })
  return res.data.balance
}
