// 여행 가계부 엑셀(여행 목록 시트 + 여행별 시트) 파싱 → 우리 데이터로 변환
import dayjs from 'dayjs'
import { COUNTRIES, type Category, type ExpenseInput } from '../types'

export interface XlsxTrip {
  name: string; sheet: string; startDate: string; endDate: string
  localCurrency: string; countryCode: string; exchangeRate: number
  rows: XlsxRow[]
}
export interface XlsxRow {
  dayLabel: string; date: string; prep: boolean; title: string; category: Category
  amount: number; currency: string; rate: number; amountKrw: number; place: string
}

const CAT: Record<string, Category> = { 식비: 'FOOD', 교통: 'TRANSPORT', 항공: 'TRANSPORT', 숙박: 'LODGING', 관광: 'SIGHTSEEING', 쇼핑: 'SHOPPING', 기타: 'ETC' }
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0 }
const str = (v: unknown) => (v == null ? '' : String(v).trim())

export async function parseLedgerXlsx(file: File): Promise<XlsxTrip[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const listSheet = wb.Sheets['여행 목록']
  const trips: XlsxTrip[] = []
  // 여행 목록 시트가 있으면 그걸로, 없으면 시트명만으로
  const entries: { name: string; sheet: string; period: string }[] = []
  if (listSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(listSheet, { defval: null })
    for (const r of rows) {
      const name = str(r['여행명']), sheet = str(r['시트명']) || name, period = str(r['여행 기간'])
      if (name && wb.Sheets[sheet]) entries.push({ name, sheet, period })
    }
  } else {
    for (const sheet of wb.SheetNames) entries.push({ name: sheet, sheet, period: '' })
  }
  for (const e of entries) {
    const ws = wb.Sheets[e.sheet]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
    const m = e.period.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/)
    let startDate = m?.[1] ?? '', endDate = m?.[2] ?? ''
    const rows: XlsxRow[] = []
    for (const r of raw) {
      const dayLabel = str(r['일차']), title = str(r['항목명'])
      const amount = num(r['금액'])
      if (!dayLabel || !title || amount <= 0) continue // 합계/빈 행 제외
      const currency = (str(r['통화']) || 'KRW').toUpperCase()
      const rate = num(r['통화 당 원화']) || 1
      const amountKrw = Math.round(num(r['원화 환산']) || amount * rate)
      const prep = /준비/.test(dayLabel)
      const dm = dayLabel.match(/(\d+)\s*일차/)
      rows.push({ dayLabel, date: '', prep, title, category: CAT[str(r['카테고리'])] ?? 'ETC', amount, currency, rate, amountKrw, place: str(r['장소']),
        ...(dm ? { _day: Number(dm[1]) } : {}) } as XlsxRow & { _day?: number })
    }
    // 기간이 없으면 일차 최대값으로 추정 불가 → 오늘 기준 건너뜀
    if (!startDate) continue
    if (!endDate) endDate = startDate
    for (const r of rows as (XlsxRow & { _day?: number })[]) {
      r.date = r.prep ? dayjs(startDate).subtract(1, 'day').format('YYYY-MM-DD')
        : r._day ? dayjs(startDate).add(r._day - 1, 'day').format('YYYY-MM-DD') : startDate
      delete r._day
    }
    // 현지 통화: KRW 외 가장 많이 쓰인 통화
    const cnt: Record<string, number> = {}
    for (const r of rows) if (r.currency !== 'KRW') cnt[r.currency] = (cnt[r.currency] ?? 0) + 1
    const localCurrency = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'KRW'
    const rateRow = rows.find((r) => r.currency === localCurrency && r.rate > 0)
    const countryCode = COUNTRIES.find((c) => c.currency === localCurrency)?.code ?? (localCurrency === 'KRW' ? 'KR' : 'XX')
    trips.push({ name: e.name, sheet: e.sheet, startDate, endDate, localCurrency, countryCode, exchangeRate: localCurrency === 'KRW' ? 1 : rateRow?.rate ?? 1, rows })
  }
  return trips
}

/** 시트 행 → 지출 입력 (여행의 통화 기준) */
export function rowToExpense(r: XlsxRow, tripId: string, localCurrency: string, baseCurrency: string, tripRate: number): ExpenseInput {
  const isLocal = r.currency === localCurrency && localCurrency !== baseCurrency
  const memo = (r.prep ? '[준비] ' : '') + r.title
  if (isLocal) {
    return { tripId, amountLocal: r.amount, amountBase: r.amountKrw, currency: localCurrency, category: r.category, paymentMethod: 'CARD',
      exchangeRate: r.rate, source: 'xlsx', memo, place: r.place, spentAt: `${r.date}T12:00:00` }
  }
  // 원화(또는 제3통화 → 원화 환산값으로) 입력
  const base = r.currency === baseCurrency ? r.amount : r.amountKrw
  const rate = localCurrency === baseCurrency ? 1 : (r.currency === localCurrency && r.rate > 0 ? r.rate : tripRate || 1)
  return { tripId, amountLocal: localCurrency === baseCurrency ? base : Math.round((base / rate) * 100) / 100, amountBase: base, currency: baseCurrency,
    category: r.category, paymentMethod: 'CARD', exchangeRate: rate, source: 'xlsx',
    memo: r.currency !== baseCurrency && !isLocal ? `${memo} (${r.amount} ${r.currency})` : memo, place: r.place, spentAt: `${r.date}T12:00:00` }
}
