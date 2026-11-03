import dayjs from 'dayjs'
import 'dayjs/locale/ko'
import { CURRENCY_SYMBOL } from '../types'

dayjs.locale('ko')

const ZERO_DECIMAL = new Set(['KRW', 'JPY', 'VND', 'IDR'])

export function fmtMoney(amount: number, currency: string, opts: { compact?: boolean } = {}) {
  const sym = CURRENCY_SYMBOL[currency] ?? currency + ' '
  const digits = ZERO_DECIMAL.has(currency) ? 0 : (Number.isInteger(amount) ? 0 : 2)
  const n = new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: 0, maximumFractionDigits: digits,
    ...(opts.compact && Math.abs(amount) >= 1_000_000 ? { notation: 'compact' as const } : {}),
  }).format(amount)
  return `${sym}${n}`
}

export const toBase = (amountLocal: number, rate: number, baseCurrency: string) => {
  const v = amountLocal * rate
  return ZERO_DECIMAL.has(baseCurrency) ? Math.round(v) : Math.round(v * 100) / 100
}
export const toLocal = (amountBase: number, rate: number, localCurrency: string) => {
  const v = amountBase / rate
  return ZERO_DECIMAL.has(localCurrency) ? Math.round(v) : Math.round(v * 100) / 100
}

export const dateKey = (iso: string) => dayjs(iso).format('YYYY-MM-DD')
export const fmtDate = (d: string, f = 'M/D (dd)') => dayjs(d).format(f)
export const fmtTime = (iso: string) => dayjs(iso).format('HH:mm')
export const todayKey = () => dayjs().format('YYYY-MM-DD')
export const nowLocalISO = () => dayjs().format('YYYY-MM-DDTHH:mm')

/** 여행 기간 내 날짜 배열 */
export function tripDays(start: string, end: string): string[] {
  const out: string[] = []
  let d = dayjs(start); const e = dayjs(end)
  while (!d.isAfter(e, 'day') && out.length < 400) { out.push(d.format('YYYY-MM-DD')); d = d.add(1, 'day') }
  return out
}
export const dayNumber = (start: string, date: string) => dayjs(date).diff(dayjs(start), 'day') + 1

export function tripStatus(start: string, end: string): 'upcoming' | 'ongoing' | 'done' {
  const t = dayjs().startOf('day')
  if (t.isBefore(dayjs(start), 'day')) return 'upcoming'
  if (t.isAfter(dayjs(end), 'day')) return 'done'
  return 'ongoing'
}
export const daysUntil = (date: string) => dayjs(date).startOf('day').diff(dayjs().startOf('day'), 'day')
