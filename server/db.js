// SQLite 저장 레이어 (Node 22+ 내장 node:sqlite, 네이티브 빌드 불필요)
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const DB_PATH = process.env.DB_PATH || './data/ledger.sqlite'
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
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

const now = () => new Date().toISOString()

// ---------- row <-> object ----------
const tripFromRow = (r) => r && ({
  id: r.id, title: r.title, countryCode: r.country_code, city: r.city,
  startDate: r.start_date, endDate: r.end_date,
  localCurrency: r.local_currency, baseCurrency: r.base_currency,
  exchangeRate: r.exchange_rate, budget: r.budget ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
})
const expenseFromRow = (r) => r && ({
  id: r.id, tripId: r.trip_id,
  amountLocal: r.amount_local, amountBase: r.amount_base, currency: r.currency,
  category: r.category, paymentMethod: r.payment_method,
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
  return null
}

// ---------- trips ----------
const qTrips = db.prepare(`
  SELECT t.*, COALESCE(SUM(e.amount_base),0) AS total_base, COUNT(e.id) AS expense_count
  FROM trips t LEFT JOIN expenses e ON e.trip_id = t.id
  GROUP BY t.id ORDER BY t.start_date DESC`)
const qTrip = db.prepare('SELECT * FROM trips WHERE id = ?')
const iTrip = db.prepare(`INSERT INTO trips
  (id,title,country_code,city,start_date,end_date,local_currency,base_currency,exchange_rate,budget,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
const uTrip = db.prepare(`UPDATE trips SET title=?,country_code=?,city=?,start_date=?,end_date=?,
  local_currency=?,base_currency=?,exchange_rate=?,budget=?,updated_at=? WHERE id=?`)
const dTrip = db.prepare('DELETE FROM trips WHERE id = ?')

export function listTrips() {
  return qTrips.all().map((r) => ({ ...tripFromRow(r), totalBase: r.total_base, expenseCount: r.expense_count }))
}
export function getTrip(id) { return tripFromRow(qTrip.get(id)) }
export function createTrip(b) {
  const id = b.id || randomUUID(); const t = now()
  iTrip.run(id, b.title.trim(), str(b.countryCode, 'XX'), str(b.city), b.startDate, b.endDate,
    b.localCurrency, str(b.baseCurrency, 'KRW'), b.exchangeRate, b.budget ?? null, b.createdAt || t, t)
  return getTrip(id)
}
export function updateTrip(id, b) {
  const cur = getTrip(id); if (!cur) return null
  const m = { ...cur, ...b }
  uTrip.run(m.title.trim(), m.countryCode, m.city, m.startDate, m.endDate,
    m.localCurrency, m.baseCurrency, m.exchangeRate, m.budget ?? null, now(), id)
  return getTrip(id)
}
export function deleteTrip(id) { return dTrip.run(id).changes > 0 }

// 환율 변경 시 전체 재계산 (사용자가 명시적으로 요청할 때만)
const uRecalc = db.prepare(`UPDATE expenses SET amount_base = CASE
  WHEN currency = ? THEN amount_local * ? ELSE amount_local END, updated_at = ? WHERE trip_id = ?`)
export function recalcTrip(id) {
  const t = getTrip(id); if (!t) return null
  uRecalc.run(t.localCurrency, t.exchangeRate, now(), id)
  return listExpenses(id)
}

// ---------- expenses ----------
const qExpenses = db.prepare('SELECT * FROM expenses WHERE trip_id = ? ORDER BY spent_at DESC, created_at DESC')
const qExpense = db.prepare('SELECT * FROM expenses WHERE id = ?')
const iExpense = db.prepare(`INSERT INTO expenses
  (id,trip_id,amount_local,amount_base,currency,category,payment_method,memo,place,spent_at,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
const uExpense = db.prepare(`UPDATE expenses SET amount_local=?,amount_base=?,currency=?,category=?,
  payment_method=?,memo=?,place=?,spent_at=?,updated_at=? WHERE id=?`)
const dExpense = db.prepare('DELETE FROM expenses WHERE id = ?')

export function listExpenses(tripId) { return qExpenses.all(tripId).map(expenseFromRow) }
export function getExpense(id) { return expenseFromRow(qExpense.get(id)) }
export function createExpense(b) {
  if (!getTrip(b.tripId)) return null
  const id = b.id || randomUUID(); const t = now()
  iExpense.run(id, b.tripId, b.amountLocal, b.amountBase, b.currency, b.category, b.paymentMethod,
    str(b.memo), str(b.place), b.spentAt, b.createdAt || t, t)
  return getExpense(id)
}
export function updateExpense(id, b) {
  const cur = getExpense(id); if (!cur) return null
  const m = { ...cur, ...b }
  uExpense.run(m.amountLocal, m.amountBase, m.currency, m.category, m.paymentMethod,
    str(m.memo), str(m.place), m.spentAt, now(), id)
  return getExpense(id)
}
export function deleteExpense(id) { return dExpense.run(id).changes > 0 }

// ---------- backup ----------
export function exportAll() {
  return {
    version: 1, exportedAt: now(),
    trips: db.prepare('SELECT * FROM trips').all().map(tripFromRow),
    expenses: db.prepare('SELECT * FROM expenses').all().map(expenseFromRow),
  }
}
export function importAll(payload, { replace = false } = {}) {
  const trips = Array.isArray(payload?.trips) ? payload.trips : []
  const expenses = Array.isArray(payload?.expenses) ? payload.expenses : []
  const tx = db.prepare('BEGIN'); const ok = db.prepare('COMMIT'); const bad = db.prepare('ROLLBACK')
  tx.run()
  try {
    if (replace) { db.exec('DELETE FROM expenses; DELETE FROM trips;') }
    let tc = 0, ec = 0
    for (const t of trips) {
      if (validateTrip(t)) continue
      if (getTrip(t.id)) updateTrip(t.id, t); else createTrip(t)
      tc++
    }
    for (const e of expenses) {
      if (validateExpense(e)) continue
      if (getExpense(e.id)) updateExpense(e.id, e); else if (createExpense(e)) {}
      ec++
    }
    ok.run()
    return { trips: tc, expenses: ec }
  } catch (err) { bad.run(); throw err }
}
