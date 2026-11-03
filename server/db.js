// 저장 레이어: libSQL(Turso) 클라이언트
//  - TURSO_DATABASE_URL + TURSO_AUTH_TOKEN 이 있으면 Turso 원격 DB
//  - 없으면 로컬 파일 (file:./data/ledger.sqlite)  → 개발/셀프호스팅용
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const url = process.env.TURSO_DATABASE_URL || `file:${process.env.DB_PATH || './data/ledger.sqlite'}`
if (url.startsWith('file:')) mkdirSync(url.replace(/^file:/, '').replace(/\/[^/]*$/, '') || '.', { recursive: true })

export const isRemote = !url.startsWith('file:')
// 원격(Turso)은 fetch 기반 web 클라이언트(네이티브 바이너리 불필요 → Vercel 등 서버리스 OK), 로컬 파일은 네이티브 클라이언트
const { createClient } = isRemote ? await import('@libsql/client/web') : await import('@libsql/client')
export const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

export async function migrate() {
  await db.executeMultiple(`
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  country_code TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  local_currency TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'KRW',
  exchange_rate REAL NOT NULL,
  budget REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  amount_local REAL NOT NULL,
  amount_base REAL NOT NULL,
  currency TEXT NOT NULL,
  category TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  spent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_trip_spent ON expenses(trip_id, spent_at);
`)
  // 지출별 환율 컬럼 (기존 DB 호환)
  try { await db.execute('ALTER TABLE expenses ADD COLUMN exchange_rate REAL') } catch { /* already exists */ }
}

const now = () => new Date().toISOString()
const q = (sql, args = []) => db.execute({ sql, args })

// ---------- row <-> object ----------
const tripFromRow = (r) => r && ({
  id: r.id, title: r.title, countryCode: r.country_code, city: r.city,
  startDate: r.start_date, endDate: r.end_date,
  localCurrency: r.local_currency, baseCurrency: r.base_currency,
  exchangeRate: Number(r.exchange_rate), budget: r.budget == null ? null : Number(r.budget),
  createdAt: r.created_at, updatedAt: r.updated_at,
})
const expenseFromRow = (r) => r && ({
  id: r.id, tripId: r.trip_id,
  amountLocal: Number(r.amount_local), amountBase: Number(r.amount_base), currency: r.currency,
  category: r.category, paymentMethod: r.payment_method,
  exchangeRate: r.exchange_rate == null ? null : Number(r.exchange_rate),
  memo: r.memo, place: r.place, spentAt: r.spent_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
})

// ---------- validation ----------
const CATEGORIES = new Set(['FOOD', 'TRANSPORT', 'LODGING', 'SIGHTSEEING', 'SHOPPING', 'ETC'])
const PAYMENTS = new Set(['CASH', 'CARD'])
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback)

export function validateTrip(b) {
  if (!str(b.title).trim()) return '제목을 입력해주세요'
  if (!str(b.localCurrency)) return '현지 통화가 필요합니다'
  if (!str(b.startDate) || !str(b.endDate)) return '기간을 입력해주세요'
  if (b.startDate > b.endDate) return '종료일이 시작일보다 빠릅니다'
  if (!isNum(b.exchangeRate) || b.exchangeRate <= 0) return '환율은 0보다 커야 합니다'
  if (b.budget != null && (!isNum(b.budget) || b.budget < 0)) return '예산이 올바르지 않습니다'
  return null
}
export function validateExpense(b) {
  if (!str(b.tripId)) return 'tripId가 필요합니다'
  if (!isNum(b.amountLocal) || b.amountLocal < 0) return '금액이 올바르지 않습니다'
  if (!isNum(b.amountBase) || b.amountBase < 0) return '환산 금액이 올바르지 않습니다'
  if (!CATEGORIES.has(b.category)) return '카테고리가 올바르지 않습니다'
  if (!PAYMENTS.has(b.paymentMethod)) return '결제수단이 올바르지 않습니다'
  if (!str(b.spentAt)) return '날짜가 필요합니다'
  if (b.exchangeRate != null && (!isNum(b.exchangeRate) || b.exchangeRate <= 0)) return '환율이 올바르지 않습니다'
  return null
}

// ---------- trips ----------
export async function listTrips() {
  const r = await q(`SELECT t.*, COALESCE(SUM(e.amount_base),0) AS total_base, COUNT(e.id) AS expense_count
    FROM trips t LEFT JOIN expenses e ON e.trip_id = t.id GROUP BY t.id ORDER BY t.start_date DESC`)
  return r.rows.map((row) => ({ ...tripFromRow(row), totalBase: Number(row.total_base), expenseCount: Number(row.expense_count) }))
}
export async function getTrip(id) { return tripFromRow((await q('SELECT * FROM trips WHERE id = ?', [id])).rows[0]) }
export async function createTrip(b) {
  const id = b.id || randomUUID(); const t = now()
  await q(`INSERT INTO trips (id,title,country_code,city,start_date,end_date,local_currency,base_currency,exchange_rate,budget,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, b.title.trim(), str(b.countryCode, 'XX'), str(b.city), b.startDate, b.endDate, b.localCurrency,
      str(b.baseCurrency, 'KRW'), b.exchangeRate, b.budget ?? null, b.createdAt || t, t])
  return getTrip(id)
}
export async function updateTrip(id, b) {
  const cur = await getTrip(id); if (!cur) return null
  const m = { ...cur, ...b }
  await q(`UPDATE trips SET title=?,country_code=?,city=?,start_date=?,end_date=?,local_currency=?,base_currency=?,exchange_rate=?,budget=?,updated_at=? WHERE id=?`,
    [m.title.trim(), m.countryCode, m.city, m.startDate, m.endDate, m.localCurrency, m.baseCurrency, m.exchangeRate, m.budget ?? null, now(), id])
  return getTrip(id)
}
export async function deleteTrip(id) {
  await q('DELETE FROM expenses WHERE trip_id = ?', [id]) // FK cascade 미설정 환경 대비
  return (await q('DELETE FROM trips WHERE id = ?', [id])).rowsAffected > 0
}
// 환율 변경 시 전체 재계산 (사용자가 명시적으로 요청할 때만)
export async function recalcTrip(id) {
  const t = await getTrip(id); if (!t) return null
  await q(`UPDATE expenses SET amount_base = CASE WHEN currency = ? THEN amount_local * ? ELSE amount_local END, exchange_rate = ?, updated_at = ? WHERE trip_id = ?`,
    [t.localCurrency, t.exchangeRate, t.exchangeRate, now(), id])
  return listExpenses(id)
}

// ---------- expenses ----------
export async function listExpenses(tripId) {
  return (await q('SELECT * FROM expenses WHERE trip_id = ? ORDER BY spent_at DESC, created_at DESC', [tripId])).rows.map(expenseFromRow)
}
export async function getExpense(id) { return expenseFromRow((await q('SELECT * FROM expenses WHERE id = ?', [id])).rows[0]) }
export async function createExpense(b) {
  if (!(await getTrip(b.tripId))) return null
  const id = b.id || randomUUID(); const t = now()
  await q(`INSERT INTO expenses (id,trip_id,amount_local,amount_base,currency,category,payment_method,exchange_rate,memo,place,spent_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, b.tripId, b.amountLocal, b.amountBase, b.currency, b.category, b.paymentMethod, b.exchangeRate ?? null, str(b.memo), str(b.place), b.spentAt, b.createdAt || t, t])
  return getExpense(id)
}
export async function updateExpense(id, b) {
  const cur = await getExpense(id); if (!cur) return null
  const m = { ...cur, ...b }
  await q(`UPDATE expenses SET amount_local=?,amount_base=?,currency=?,category=?,payment_method=?,exchange_rate=?,memo=?,place=?,spent_at=?,updated_at=? WHERE id=?`,
    [m.amountLocal, m.amountBase, m.currency, m.category, m.paymentMethod, m.exchangeRate ?? null, str(m.memo), str(m.place), m.spentAt, now(), id])
  return getExpense(id)
}
export async function deleteExpense(id) { return (await q('DELETE FROM expenses WHERE id = ?', [id])).rowsAffected > 0 }

// ---------- backup ----------
export async function exportAll() {
  return {
    version: 1, exportedAt: now(),
    trips: (await q('SELECT * FROM trips')).rows.map(tripFromRow),
    expenses: (await q('SELECT * FROM expenses')).rows.map(expenseFromRow),
  }
}
export async function importAll(payload, { replace = false } = {}) {
  const trips = Array.isArray(payload?.trips) ? payload.trips : []
  const expenses = Array.isArray(payload?.expenses) ? payload.expenses : []
  if (replace) await db.executeMultiple('DELETE FROM expenses; DELETE FROM trips;')
  let tc = 0, ec = 0
  for (const t of trips) {
    if (validateTrip(t)) continue
    if (await getTrip(t.id)) await updateTrip(t.id, t); else await createTrip(t)
    tc++
  }
  for (const e of expenses) {
    if (validateExpense(e)) continue
    if (await getExpense(e.id)) await updateExpense(e.id, e); else if (!(await createExpense(e))) continue
    ec++
  }
  return { trips: tc, expenses: ec }
}
