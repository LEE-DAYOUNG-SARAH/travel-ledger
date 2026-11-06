// 인증: 구글 로그인(기본) 또는 PIN(로컬 개발용). 세션 토큰은 HMAC 서명 (서버 상태 없음)
import { createHmac, timingSafeEqual } from 'node:crypto'

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
export const APP_PIN = process.env.APP_PIN || ''
export const MODE = GOOGLE_CLIENT_ID ? 'google' : APP_PIN ? 'pin' : 'none'
const SECRET = process.env.APP_SECRET || 'dev-secret-' + (APP_PIN || GOOGLE_CLIENT_ID)
const ALLOWED = (process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const TOKEN_TTL_SEC = 60 * 60 * 24 * 90 // 90일

const b64u = (s) => Buffer.from(s).toString('base64url')
const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url')
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

/** PIN 모드 단일 사용자 — owner_id 고정 */
export const PIN_USER = { id: 'pin-user', email: 'pin@local', name: '나', picture: '' }

export function issueToken(user) {
  const payload = b64u(JSON.stringify({ sub: user.id, email: user.email, name: user.name, picture: user.picture, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC }))
  return `${payload}.${sign(payload)}`
}
export function verifyToken(token) {
  if (!token) return null
  const i = token.lastIndexOf('.'); if (i < 0) return null
  const payload = token.slice(0, i), sig = token.slice(i + 1)
  if (!safeEq(sig, sign(payload))) return null
  try {
    const u = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!u.sub || !u.exp || u.exp < Date.now() / 1000) return null
    return { id: u.sub, email: u.email, name: u.name || '', picture: u.picture || '' }
  } catch { return null }
}

export function checkPin(pin) { return MODE === 'pin' && typeof pin === 'string' && safeEq(pin, APP_PIN) }

export const isAllowedEmail = (email) => ALLOWED.length === 0 || ALLOWED.includes(String(email).toLowerCase())
export const hasAllowlist = () => ALLOWED.length > 0

/** 구글 ID 토큰 검증 → { id, email, name, picture } | { error } */
export async function verifyGoogleCredential(credential) {
  if (MODE !== 'google' || typeof credential !== 'string') return { error: '구글 로그인이 설정되지 않았습니다' }
  let info
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { signal: AbortSignal.timeout(6000) })
    info = await r.json()
    if (!r.ok) return { error: '구글 토큰이 유효하지 않습니다' }
  } catch { return { error: '구글 인증 서버에 연결할 수 없습니다' } }
  if (info.aud !== GOOGLE_CLIENT_ID) return { error: '토큰 대상(aud)이 일치하지 않습니다' }
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) return { error: '발급자가 올바르지 않습니다' }
  if (Number(info.exp) < Date.now() / 1000) return { error: '토큰이 만료되었습니다' }
  if (info.email_verified !== 'true' && info.email_verified !== true) return { error: '이메일이 인증되지 않은 계정입니다' }
  if (!isAllowedEmail(info.email)) return { error: '허용되지 않은 계정입니다' }
  return { id: 'google:' + info.sub, email: info.email, name: info.name || '', picture: info.picture || '' }
}
