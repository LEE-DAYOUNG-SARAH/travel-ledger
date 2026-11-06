// 운영자 알림 메일 (Resend). RESEND_API_KEY 없으면 조용히 건너뜀.
const KEY = process.env.RESEND_API_KEY || ''
const OWNER = process.env.OWNER_EMAIL || ''
const FROM = process.env.NOTIFY_FROM || '여행 가계부 <onboarding@resend.dev>'
export const notifyEnabled = () => !!(KEY && OWNER)

export async function notifyOwner(subject, text) {
  if (!notifyEnabled()) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [OWNER], subject, text }), signal: AbortSignal.timeout(8000),
    })
    return r.ok
  } catch { return false }
}
