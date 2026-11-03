// Vercel 서버리스 함수 진입점 — /api/* 와 /healthz 가 여기로 라우팅됨 (vercel.json)
import { handle } from 'hono/vercel'
import { app } from '../server/app.js'

export default handle(app)
