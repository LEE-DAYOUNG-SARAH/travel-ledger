// API 정의 (Node 서버와 Vercel 함수가 공유)
import { Hono } from 'hono'
import { createHmac, timingSafeEqual } from 'node:crypto'
import * as store from './db.js'

const APP_PIN = process.env.APP_PIN || ''            // 비어 있으면 인증 없음
const SECRET = process.env.APP_SECRET || 'change-me-' + APP_PIN

const tokenFor = (pin) => createHmac('sha256', SECRET).update(pin).digest('hex')
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const api = new Hono()

// 테이블 보장 (인스턴스당 1회) — 서버리스에서도 동작
let ready
api.use('*', async (_c, next) => { await (ready ??= store.migrate()); return next() })

// ---- auth ----
api.get('/auth/status', (c) => c.json({ required: !!APP_PIN }))
api.post('/auth/login', async (c) => {
  if (!APP_PIN) return c.json({ token: '' })
  const { pin } = await c.req.json().catch(() => ({}))
  if (typeof pin !== 'string' || !safeEq(pin, APP_PIN)) return c.json({ error: 'PIN이 올바르지 않습니다' }, 401)
  return c.json({ token: tokenFor(pin) })
})
api.use('*', async (c, next) => {
  if (!APP_PIN || c.req.path.startsWith('/api/auth/')) return next()
  const auth = c.req.header('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token || !safeEq(token, tokenFor(APP_PIN))) return c.json({ error: 'unauthorized' }, 401)
  return next()
})

// ---- trips ----
api.get('/trips', async (c) => c.json(await store.listTrips()))
api.post('/trips', async (c) => {
  const b = await c.req.json()
  const err = store.validateTrip(b); if (err) return c.json({ error: err }, 400)
  return c.json(await store.createTrip(b), 201)
})
api.get('/trips/:id', async (c) => {
  const t = await store.getTrip(c.req.param('id')); return t ? c.json(t) : c.json({ error: 'not found' }, 404)
})
api.put('/trips/:id', async (c) => {
  const cur = await store.getTrip(c.req.param('id')); if (!cur) return c.json({ error: 'not found' }, 404)
  const b = { ...cur, ...(await c.req.json()) }
  const err = store.validateTrip(b); if (err) return c.json({ error: err }, 400)
  return c.json(await store.updateTrip(cur.id, b))
})
api.delete('/trips/:id', async (c) => c.json({ ok: await store.deleteTrip(c.req.param('id')) }))
api.post('/trips/:id/recalc', async (c) => {
  const r = await store.recalcTrip(c.req.param('id')); return r ? c.json(r) : c.json({ error: 'not found' }, 404)
})
api.get('/trips/:id/expenses', async (c) => c.json(await store.listExpenses(c.req.param('id'))))

// ---- expenses ----
api.post('/expenses', async (c) => {
  const b = await c.req.json()
  const err = store.validateExpense(b); if (err) return c.json({ error: err }, 400)
  const e = await store.createExpense(b); return e ? c.json(e, 201) : c.json({ error: 'trip not found' }, 404)
})
api.put('/expenses/:id', async (c) => {
  const cur = await store.getExpense(c.req.param('id')); if (!cur) return c.json({ error: 'not found' }, 404)
  const b = { ...cur, ...(await c.req.json()) }
  const err = store.validateExpense(b); if (err) return c.json({ error: err }, 400)
  return c.json(await store.updateExpense(cur.id, b))
})
api.delete('/expenses/:id', async (c) => c.json({ ok: await store.deleteExpense(c.req.param('id')) }))

// ---- backup ----
api.get('/export', async (c) => c.json(await store.exportAll()))
api.post('/import', async (c) => {
  const replace = c.req.query('replace') === '1'
  try { return c.json(await store.importAll(await c.req.json(), { replace })) }
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
export { APP_PIN }
