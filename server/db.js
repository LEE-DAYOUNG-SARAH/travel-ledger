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
CREATE TABLE IF NOT EXISTS import_requests (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
`)
  // 점진적 마이그레이션 (이미 있으면 무시)
  for (const sql of [
    'ALTER TABLE expenses ADD COLUMN exchange_rate REAL',
    'ALTER TABLE trips ADD COLUMN owner_id TEXT',
    'CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips(owner_id, start_date)',
    "ALTER TABLE expenses ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
    'ALTER TABLE expenses ADD COLUMN import_key TEXT',
    'CREATE INDEX IF NOT EXISTS idx_expenses_import ON expenses(trip_id, import_key)',
  ]) { try { await db.execute(sql) } catch { /* already applied */ } }
}

const now = () => new Date().toISOString()
const q = (sql, args = []) => db.execute({ sql, args })

// ---------- row <-> object ----------
const tripFromRow = (r) => r && ({
  id: r.id, title: r.title, countryCode: r.country_code, city: r.city,
  startDate: r.start_date, endDate: r.end_date,
  localCurrency: r.local_currency, baseCurrency: r.base_currency,
  exchangeRate: Number(r.exchange_rate), budget: r.budget == null ? null : Number(r.budget),
  ownerId: r.owner_id ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
})
const expenseFromRow = (r) => r && ({
  id: r.id, tripId: r.trip_id,
  amountLocal: Number(r.amount_local), amountBase: Number(r.amount_base), currency: r.currency,
  category: r.category, paymentMethod: r.payment_method,
  exchangeRate: r.exchange_rate == null ? null : Number(r.exchange_rate),
  source: r.source || 'manual', importKey: r.import_key ?? null,
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

// ---------- users ----------
export async function countUsers() { return Number((await q("SELECT COUNT(*) AS n FROM users WHERE id != 'pin-user'")).rows[0].n) }
export async function upsertUser(u) {
  const t = now()
  await q(`INSERT INTO users (id,email,name,picture,created_at,last_login_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture, last_login_at=excluded.last_login_at`,
    [u.id, u.email, str(u.name), str(u.picture), t, t])
}
/** 소유자 없는(로그인 도입 이전) 여행을 이 사용자에게 귀속 */
export async function claimLegacyTrips(ownerId) {
  return (await q("UPDATE trips SET owner_id = ? WHERE owner_id IS NULL OR owner_id = 'pin-user'", [ownerId])).rowsAffected
}

// ---------- 캡처 가져오기 사용 요청 ----------
export async function getImportRequest(userId) {
  const r = (await q('SELECT * FROM import_requests WHERE user_id = ?', [userId])).rows[0]
  return r ? { userId: r.user_id, email: r.email, name: r.name, message: r.message, requestedAt: r.requested_at, notified: !!r.notified } : null
}
export async function upsertImportRequest(u, message, notified) {
  await q(`INSERT INTO import_requests (user_id,email,name,message,requested_at,notified) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET message=excluded.message, requested_at=excluded.requested_at, notified=excluded.notified`,
    [u.id, u.email, str(u.name), str(message).slice(0, 300), now(), notified ? 1 : 0])
}

// ---------- trips (모두 owner 범위) ----------
export async function listTrips(ownerId) {
  const r = await q(`SELECT t.*, COALESCE(SUM(e.amount_base),0) AS total_base, COUNT(e.id) AS expense_count
    FROM trips t LEFT JOIN expenses e ON e.trip_id = t.id WHERE t.owner_id = ? GROUP BY t.id ORDER BY t.start_date DESC`, [ownerId])
  return r.rows.map((row) => ({ ...tripFromRow(row), totalBase: Number(row.total_base), expenseCount: Number(row.expense_count) }))
}
export async function getTrip(id, ownerId) {
  return tripFromRow((await q('SELECT * FROM trips WHERE id = ? AND owner_id = ?', [id, ownerId])).rows[0])
}
export async function createTrip(b, ownerId) {
  const id = b.id || randomUUID(); const t = now()
  await q(`INSERT INTO trips (id,title,country_code,city,start_date,end_date,local_currency,base_currency,exchange_rate,budget,owner_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, b.title.trim(), str(b.countryCode, 'XX'), str(b.city), b.startDate, b.endDate, b.localCurrency,
      str(b.baseCurrency, 'KRW'), b.exchangeRate, b.budget ?? null, ownerId, b.createdAt || t, t])
  return getTrip(id, ownerId)
}
export async function updateTrip(id, b, ownerId) {
  const cur = await getTrip(id, ownerId); if (!cur) return null
  const m = { ...cur, ...b }
  await q(`UPDATE trips SET title=?,country_code=?,city=?,start_date=?,end_date=?,local_currency=?,base_currency=?,exchange_rate=?,budget=?,updated_at=? WHERE id=? AND owner_id=?`,
    [m.title.trim(), m.countryCode, m.city, m.startDate, m.endDate, m.localCurrency, m.baseCurrency, m.exchangeRate, m.budget ?? null, now(), id, ownerId])
  return getTrip(id, ownerId)
}
export async function deleteTrip(id, ownerId) {
  if (!(await getTrip(id, ownerId))) return false
  await q('DELETE FROM expenses WHERE trip_id = ?', [id])
  return (await q('DELETE FROM trips WHERE id = ? AND owner_id = ?', [id, ownerId])).rowsAffected > 0
}
// 환율 변경 시 전체 재계산 (사용자가 명시적으로 요청할 때만)
export async function recalcTrip(id, ownerId) {
  const t = await getTrip(id, ownerId); if (!t) return null
  await q(`UPDATE expenses SET amount_base = CASE WHEN currency = ? THEN amount_local * ? ELSE amount_local END, exchange_rate = ?, updated_at = ? WHERE trip_id = ?`,
    [t.localCurrency, t.exchangeRate, t.exchangeRate, now(), id])
  return listExpenses(id)
}

// ---------- expenses ----------
export async function listExpenses(tripId, ownerId) {
  return (await q(`SELECT e.* FROM expenses e JOIN trips t ON t.id = e.trip_id
    WHERE e.trip_id = ? AND t.owner_id = ? ORDER BY e.spent_at DESC, e.created_at DESC`, [tripId, ownerId])).rows.map(expenseFromRow)
}
export async function getExpense(id, ownerId) {
  return expenseFromRow((await q('SELECT e.* FROM expenses e JOIN trips t ON t.id = e.trip_id WHERE e.id = ? AND t.owner_id = ?', [id, ownerId])).rows[0])
}
export async function createExpense(b, ownerId) {
  const id = b.id || randomUUID(); const t = now()
  // 여행 존재+소유 확인을 INSERT … SELECT 로 합쳐 왕복 1회
  const source = str(b.source, 'manual') || 'manual'
  const r = await q(`INSERT INTO expenses (id,trip_id,amount_local,amount_base,currency,category,payment_method,exchange_rate,source,import_key,memo,place,spent_at,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM trips WHERE id = ? AND owner_id = ?)`,
    [id, b.tripId, b.amountLocal, b.amountBase, b.currency, b.category, b.paymentMethod, b.exchangeRate ?? null, source, b.importKey ?? null,
      str(b.memo), str(b.place), b.spentAt, b.createdAt || t, t, b.tripId, ownerId])
  if (!r.rowsAffected) return null
  return { id, tripId: b.tripId, amountLocal: b.amountLocal, amountBase: b.amountBase, currency: b.currency, category: b.category,
    paymentMethod: b.paymentMethod, exchangeRate: b.exchangeRate ?? null, source, importKey: b.importKey ?? null,
    memo: str(b.memo), place: str(b.place), spentAt: b.spentAt, createdAt: b.createdAt || t, updatedAt: t }
}
export async function updateExpense(id, b, cur) {
  if (!cur) return null // 호출자가 소유권 확인된 행을 넘김
  const m = { ...cur, ...b, updatedAt: now() }
  await q(`UPDATE expenses SET amount_local=?,amount_base=?,currency=?,category=?,payment_method=?,exchange_rate=?,memo=?,place=?,spent_at=?,updated_at=? WHERE id=?`,
    [m.amountLocal, m.amountBase, m.currency, m.category, m.paymentMethod, m.exchangeRate ?? null, str(m.memo), str(m.place), m.spentAt, m.updatedAt, id])
  return { ...m, memo: str(m.memo), place: str(m.place) }
}
export async function deleteExpense(id, ownerId) {
  return (await q('DELETE FROM expenses WHERE id = ? AND trip_id IN (SELECT id FROM trips WHERE owner_id = ?)', [id, ownerId])).rowsAffected > 0
}

/** 가져오기 중복 판정용: 여행의 (import_key, 날짜, 현지금액) 목록 */
export async function expenseFingerprints(tripId, ownerId) {
  const r = await q(`SELECT e.import_key, substr(e.spent_at,1,10) AS d, e.amount_local, e.currency FROM expenses e
    JOIN trips t ON t.id = e.trip_id WHERE e.trip_id = ? AND t.owner_id = ?`, [tripId, ownerId])
  return r.rows.map((x) => ({ importKey: x.import_key, date: x.d, amountLocal: Number(x.amount_local), currency: x.currency }))
}

// ---------- backup ----------
export async function exportAll(ownerId) {
  return {
    version: 1, exportedAt: now(),
    trips: (await q('SELECT * FROM trips WHERE owner_id = ?', [ownerId])).rows.map(tripFromRow),
    expenses: (await q('SELECT e.* FROM expenses e JOIN trips t ON t.id = e.trip_id WHERE t.owner_id = ?', [ownerId])).rows.map(expenseFromRow),
  }
}
export async function importAll(payload, ownerId, { replace = false } = {}) {
  const trips = Array.isArray(payload?.trips) ? payload.trips : []
  const expenses = Array.isArray(payload?.expenses) ? payload.expenses : []
  if (replace) {
    await q('DELETE FROM expenses WHERE trip_id IN (SELECT id FROM trips WHERE owner_id = ?)', [ownerId])
    await q('DELETE FROM trips WHERE owner_id = ?', [ownerId])
  }
  let tc = 0, ec = 0
  for (const t of trips) {
    if (validateTrip(t)) continue
    if (await getTrip(t.id, ownerId)) await updateTrip(t.id, t, ownerId)
    else { if (!replace && (await q('SELECT 1 FROM trips WHERE id = ?', [t.id])).rows.length) continue /* 남의 여행 id */; await createTrip(t, ownerId) }
    tc++
  }
  for (const e of expenses) {
    if (validateExpense(e)) continue
    const cur = await getExpense(e.id, ownerId)
    if (cur) await updateExpense(e.id, e, cur); else if (!(await createExpense(e, ownerId))) continue
    ec++
  }
  return { trips: tc, expenses: ec }
}
