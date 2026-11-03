// 여행 가계부 서버: REST API + 빌드된 프론트(dist) 정적 서빙
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as store from './db.js'

const PORT = Number(process.env.PORT || 3000)
const APP_PIN = process.env.APP_PIN || ''            // 비어 있으면 인증 없음
const SECRET = process.env.APP_SECRET || 'change-me-' + APP_PIN
const DIST = process.env.DIST_DIR || join(process.cwd(), 'dist')

const tokenFor = (pin) => createHmac('sha256', SECRET).update(pin).digest('hex')
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const app = new Hono()
const api = new Hono()

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
api.get('/trips', (c) => c.json(store.listTrips()))
api.post('/trips', async (c) => {
  const b = await c.req.json()
  const err = store.validateTrip(b); if (err) return c.json({ error: err }, 400)
  return c.json(store.createTrip(b), 201)
})
api.get('/trips/:id', (c) => {
  const t = store.getTrip(c.req.param('id')); return t ? c.json(t) : c.json({ error: 'not found' }, 404)
})
api.put('/trips/:id', async (c) => {
  const cur = store.getTrip(c.req.param('id')); if (!cur) return c.json({ error: 'not found' }, 404)
  const b = { ...cur, ...(await c.req.json()) }
  const err = store.validateTrip(b); if (err) return c.json({ error: err }, 400)
  return c.json(store.updateTrip(cur.id, b))
})
api.delete('/trips/:id', (c) => c.json({ ok: store.deleteTrip(c.req.param('id')) }))
api.post('/trips/:id/recalc', (c) => {
  const r = store.recalcTrip(c.req.param('id')); return r ? c.json(r) : c.json({ error: 'not found' }, 404)
})
api.get('/trips/:id/expenses', (c) => c.json(store.listExpenses(c.req.param('id'))))

// ---- expenses ----
api.post('/expenses', async (c) => {
  const b = await c.req.json()
  const err = store.validateExpense(b); if (err) return c.json({ error: err }, 400)
  const e = store.createExpense(b); return e ? c.json(e, 201) : c.json({ error: 'trip not found' }, 404)
})
api.put('/expenses/:id', async (c) => {
  const cur = store.getExpense(c.req.param('id')); if (!cur) return c.json({ error: 'not found' }, 404)
  const b = { ...cur, ...(await c.req.json()) }
  const err = store.validateExpense(b); if (err) return c.json({ error: err }, 400)
  return c.json(store.updateExpense(cur.id, b))
})
api.delete('/expenses/:id', (c) => c.json({ ok: store.deleteExpense(c.req.param('id')) }))

// ---- backup ----
api.get('/export', (c) => c.json(store.exportAll()))
api.post('/import', async (c) => {
  const replace = c.req.query('replace') === '1'
  try { return c.json(store.importAll(await c.req.json(), { replace })) }
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

app.route('/api', api)
app.get('/healthz', (c) => c.text('ok'))

// ---- static (SPA) ----
if (existsSync(DIST)) {
  app.use('/*', serveStatic({ root: DIST.startsWith('/') ? DIST.replace(process.cwd() + '/', '') : DIST }))
  const index = readFileSync(join(DIST, 'index.html'), 'utf8')
  app.get('*', (c) => c.html(index))
} else {
  app.get('*', (c) => c.text('dist/ 가 없습니다. `npm run build` 를 먼저 실행하세요.', 404))
}

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => {
  console.log(`▶ 여행 가계부 서버: http://localhost:${PORT}  (PIN ${APP_PIN ? '설정됨' : '없음'})`)
})
