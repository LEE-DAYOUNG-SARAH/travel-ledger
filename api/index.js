// Vercel 서버리스 함수 진입점 — /api/* 와 /healthz 가 여기로 라우팅됨 (vercel.json)
// Vercel Node 런타임의 Web 표준 시그니처: HTTP 메서드별 named export (Request → Response)
import { handle } from 'hono/vercel'
import { app } from '../server/app.js'

const handler = handle(app)
export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
