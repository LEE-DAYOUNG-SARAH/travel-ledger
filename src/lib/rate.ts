import { api } from './api'

export interface LiveRate { rate: number; fetchedAt: number; source: 'live' | 'cache' }
const KEY = (f: string, t: string) => `ledger.rate.${f}.${t}`
const TTL = 60 * 60 * 1000 // 1시간

/** 실시간 환율. 1시간 내 캐시가 있으면 재사용, 실패 시 null */
export async function getLiveRate(from: string, to: string): Promise<LiveRate | null> {
  if (from === to) return { rate: 1, fetchedAt: Date.now(), source: 'live' }
  try {
    const raw = localStorage.getItem(KEY(from, to))
    if (raw) { const c = JSON.parse(raw) as LiveRate; if (Date.now() - c.fetchedAt < TTL) return { ...c, source: 'cache' } }
  } catch { /* ignore */ }
  try {
    const r = await api.rate(from, to)
    const v: LiveRate = { rate: Math.round(r.rate * 10000) / 10000, fetchedAt: Date.now(), source: 'live' }
    try { localStorage.setItem(KEY(from, to), JSON.stringify(v)) } catch { /* ignore */ }
    return v
  } catch { return null }
}
