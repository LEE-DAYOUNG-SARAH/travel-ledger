// API 정의 (Node 서버와 Vercel 함수가 공유)
import { Hono } from 'hono'
import * as store from './db.js'
import * as auth from './auth.js'
import { extractExpenses, importKeyOf, visionEnabled } from './vision.js'
import { notifyOwner, notifyEnabled } from './notify.js'

const IMPORT_ALLOWED = (process.env.IMPORT_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const canImport = (user) => visionEnabled() && (IMPORT_ALLOWED.length === 0 || IMPORT_ALLOWED.includes(String(user.email).toLowerCase()))

export const APP_PIN = auth.APP_PIN
const api = new Hono()

// 테이블 보장 (인스턴스당 1회) — 서버리스에서도 동작
let ready
api.use('*', async (_c, next) => { await (ready ??= store.migrate()); return next() })

// ---- auth ----
api.get('/auth/status', (c) => c.json({ mode: auth.MODE, required: auth.MODE !== 'none', googleClientId: auth.GOOGLE_CLIENT_ID || undefined }))

/** 로그인 성공 공통 처리: 사용자 upsert + 레거시 여행 귀속 + 토큰 */
async function finishLogin(c, user) {
  const first = (await store.countUsers()) === 0
  await store.upsertUser(user)
  // 로그인 도입 전 데이터(owner 없음)는 허용 목록 계정 또는 첫 사용자에게 귀속
  if (auth.hasAllowlist() ? auth.isAllowedEmail(user.email) : first) await store.claimLegacyTrips(user.id)
  return c.json({ token: auth.issueToken(user), user })
}
api.post('/auth/login', async (c) => {           // PIN 모드
  const { pin } = await c.req.json().catch(() => ({}))
  if (!auth.checkPin(pin)) return c.json({ error: 'PIN이 올바르지 않습니다' }, 401)
  return finishLogin(c, auth.PIN_USER)
})
api.post('/auth/google', async (c) => {          // 구글 모드
  const { credential } = await c.req.json().catch(() => ({}))
  const r = await auth.verifyGoogleCredential(credential)
  if (r.error) return c.json({ error: r.error }, 401)
  return finishLogin(c, r)
})
api.use('*', async (c, next) => {
  if (/^\/api\/auth\/(status|login|google)$/.test(c.req.path)) return next()
  if (auth.MODE === 'none') { c.set('user', auth.PIN_USER); return next() }
  const token = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '')
  const user = auth.verifyToken(token)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', user); return next()
})
api.get('/auth/me', (c) => c.json(c.get('user')))
const uid = (c) => c.get('user').id

// ---- trips ----
api.get('/trips', async (c) => c.json(await store.listTrips(uid(c))))
api.post('/trips', async (c) => {
  const b = await c.req.json()
  const err = store.validateTrip(b); if (err) return c.json({ error: err }, 400)
  return c.json(await store.createTrip(b, uid(c)), 201)
})
api.get('/trips/:id', async (c) => {
  const t = await store.getTrip(c.req.param('id'), uid(c)); return t ? c.json(t) : c.json({ error: 'not found' }, 404)
})
api.put('/trips/:id', async (c) => {
  const cur = await store.getTrip(c.req.param('id'), uid(c)); if (!cur) return c.json({ error: 'not found' }, 404)
  const b = { ...cur, ...(await c.req.json()) }
  const err = store.validateTrip(b); if (err) return c.json({ error: err }, 400)
  return c.json(await store.updateTrip(cur.id, b, uid(c)))
})
api.delete('/trips/:id', async (c) => c.json({ ok: await store.deleteTrip(c.req.param('id'), uid(c)) }))
api.post('/trips/:id/recalc', async (c) => {
  const r = await store.recalcTrip(c.req.param('id'), uid(c)); return r ? c.json(r) : c.json({ error: 'not found' }, 404)
})
api.get('/trips/:id/expenses', async (c) => c.json(await store.listExpenses(c.req.param('id'), uid(c))))

// ---- expenses ----
api.post('/expenses', async (c) => {
  const b = await c.req.json()
  const err = store.validateExpense(b); if (err) return c.json({ error: err }, 400)
  const e = await store.createExpense(b, uid(c)); return e ? c.json(e, 201) : c.json({ error: 'trip not found' }, 404)
})
api.put('/expenses/:id', async (c) => {
  const cur = await store.getExpense(c.req.param('id'), uid(c)); if (!cur) return c.json({ error: 'not found' }, 404)
  const b = { ...cur, ...(await c.req.json()) }
  const err = store.validateExpense(b); if (err) return c.json({ error: err }, 400)
  return c.json(await store.updateExpense(cur.id, b, cur))
})
api.delete('/expenses/:id', async (c) => c.json({ ok: await store.deleteExpense(c.req.param('id'), uid(c)) }))

// ---- 캡처 가져오기 ----
api.get('/import/status', async (c) => {
  const user = c.get('user')
  const allowed = canImport(user)
  const req = allowed ? null : await store.getImportRequest(user.id)
  return c.json({ enabled: visionEnabled(), allowed, requested: !!req, requestedAt: req?.requestedAt ?? null })
})
// 사용 요청: 기록 + 운영자 메일 (사용자당 1건, 재요청은 덮어씀)
api.post('/import/request', async (c) => {
  const user = c.get('user')
  if (canImport(user)) return c.json({ ok: true, allowed: true })
  const { message } = await c.req.json().catch(() => ({}))
  const prev = await store.getImportRequest(user.id)
  if (prev && Date.now() - new Date(prev.requestedAt).getTime() < 24 * 3600 * 1000) return c.json({ ok: true, requested: true, throttled: true })
  const sent = await notifyOwner(`[여행 가계부] 캡처 가져오기 사용 요청 — ${user.email}`,
    `${user.name || '(이름 없음)'} <${user.email}> 님이 캡처 가져오기 기능 사용을 요청했습니다.\n\n메시지: ${String(message || '').slice(0, 300) || '(없음)'}\n\n허용하려면 Vercel 환경변수 IMPORT_ALLOWED_EMAILS 에 이 이메일을 추가하고 Redeploy 하세요.`)
  await store.upsertImportRequest(user, message || '', sent)
  return c.json({ ok: true, requested: true, notified: sent, notifyConfigured: notifyEnabled() })
})
api.post('/import/screenshots', async (c) => {
  if (!visionEnabled()) return c.json({ error: '캡처 가져오기가 설정되지 않았습니다 (GEMINI_API_KEY)' }, 503)
  if (!canImport(c.get('user'))) return c.json({ error: '이 기능은 허용된 계정만 사용할 수 있어요. 설정에서 사용을 요청해주세요.' }, 403)
  const b = await c.req.json().catch(() => ({}))
  const trip = await store.getTrip(String(b.tripId || ''), uid(c)); if (!trip) return c.json({ error: 'trip not found' }, 404)
  const images = Array.isArray(b.images) ? b.images.filter((x) => x && typeof x.data === 'string' && x.data.length > 100).slice(0, 3) : []
  if (!images.length) return c.json({ error: '이미지가 없습니다' }, 400)
  const today = typeof b.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10)
  const items = await extractExpenses(images, { today, localCurrency: trip.localCurrency, baseCurrency: trip.baseCurrency, tripStart: trip.startDate, tripEnd: trip.endDate })
  // 중복 판정: import_key 일치 또는 같은 날짜+현지금액
  const fps = await store.expenseFingerprints(trip.id, uid(c))
  const seen = new Set()
  const out = items.map((it) => {
    const importKey = importKeyOf(it)
    const d = (it.datetime || '').slice(0, 10)
    const dupExisting = fps.some((f) => f.importKey === importKey || (d && f.date === d && f.amountLocal === it.amountLocal && f.currency === it.currency))
    const dupInBatch = seen.has(importKey); seen.add(importKey)
    return { ...it, importKey, duplicate: dupExisting || dupInBatch }
  })
  return c.json({ items: out })
})
api.post('/expenses/batch', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const items = Array.isArray(b.items) ? b.items.slice(0, 50) : []
  const saved = [], errors = []
  for (const e of items) {
    const err = store.validateExpense(e); if (err) { errors.push(err); continue }
    const r = await store.createExpense(e, uid(c)); if (r) saved.push(r); else errors.push('trip not found')
  }
  return c.json({ saved, errors })
})

// ---- backup ----
api.get('/export', async (c) => c.json(await store.exportAll(uid(c))))
api.post('/import', async (c) => {
  const replace = c.req.query('replace') === '1'
  try { return c.json(await store.importAll(await c.req.json(), uid(c), { replace })) }
  catch (e) { return c.json({ error: String(e?.message || e) }, 400) }
})

// ---- 환율 (서버에서 가져와 CORS 회피) ----
api.get('/rate', async (c) => {
  const from = (c.req.query('from') || 'THB').toUpperCase()
  const to = (c.req.query('to') || 'KRW').toUpperCase()
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${from}`, { signal: AbortSignal.timeout(6000) })
    const j = await r.json()
    const rate = j?.rates?.[to]
    if (!rate) return c.json({ error: '환율을 찾을 수 없습니다' }, 502)
    return c.json({ from, to, rate, updatedAt: j.time_last_update_utc })
  } catch { return c.json({ error: '환율 서버에 연결할 수 없습니다' }, 502) }
})

api.onError((err, c) => { console.error(err); return c.json({ error: '서버 오류: ' + (err?.message || err) }, 500) })

export const app = new Hono()
app.route('/api', api)
app.get('/healthz', (c) => c.text('ok'))
