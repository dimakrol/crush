import { apiRequest } from './api'

export async function getBalance(): Promise<number> {
  const res = await apiRequest<{ balance: number }>('/api/wallet')
  return res.data.balance
}
