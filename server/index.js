// Node 서버: API + 빌드된 프론트(dist) 정적 서빙  (Render/Docker/VPS/로컬용)
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, APP_PIN } from './app.js'
import { isRemote } from './db.js'

const PORT = Number(process.env.PORT || 3000)
const DIST = process.env.DIST_DIR || join(process.cwd(), 'dist')

if (existsSync(DIST)) {
  app.use('/*', serveStatic({ root: DIST.startsWith('/') ? DIST.replace(process.cwd() + '/', '') : DIST }))
  const index = readFileSync(join(DIST, 'index.html'), 'utf8')
  app.get('*', (c) => c.html(index))
} else {
  app.get('*', (c) => c.text('dist/ 가 없습니다. `npm run build` 를 먼저 실행하세요.', 404))
}

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => {
  console.log(`▶ 여행 가계부 서버: http://localhost:${PORT}  (PIN ${APP_PIN ? '설정됨' : '없음'}, DB ${isRemote ? 'Turso' : '로컬 파일'})`)
})
