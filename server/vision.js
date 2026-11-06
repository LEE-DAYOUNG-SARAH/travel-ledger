// 스크린샷 → 지출 항목 추출 (Gemini Vision). 이미지는 메모리에서만 처리하고 저장하지 않음.
import { createHash } from 'node:crypto'

const API_KEY = process.env.GEMINI_API_KEY || ''
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
export const visionEnabled = () => !!API_KEY

const CATEGORIES = ['FOOD', 'TRANSPORT', 'LODGING', 'SIGHTSEEING', 'SHOPPING', 'ETC']
const SOURCES = ['naverpay', 'grab_food', 'grab_ride', 'bolt', 'other']

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: SOURCES },
          merchant: { type: 'string' },
          amountLocal: { type: 'number' },
          currency: { type: 'string' },
          amountKrw: { type: 'number', nullable: true },
          datetime: { type: 'string', nullable: true },
          dateUncertain: { type: 'boolean' },
          category: { type: 'string', enum: CATEGORIES },
          categoryConfidence: { type: 'number' },
          place: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['source', 'merchant', 'amountLocal', 'currency', 'dateUncertain', 'category', 'categoryConfidence'],
      },
    },
  },
  required: ['items'],
}

const prompt = ({ today, localCurrency, baseCurrency, tripStart, tripEnd }) => `
You extract expense records from screenshots of payment/activity history for a travel expense ledger.
Screens may be from: Naver Pay (네이버페이 결제 내역, Korean), Grab (food orders or rides), Bolt (rides), or other apps.
Each screenshot can contain several transactions. Return EVERY visible transaction as a separate item, top to bottom.
Skip rows that are cut off so badly the amount is unreadable, and skip "review/rate this" prompts that are not transactions.

Rules:
- source: naverpay | grab_food | grab_ride | bolt | other
- merchant: the store/restaurant name, or for rides the destination (shortened, e.g. "Common Living").
- amountLocal + currency: the amount in the local currency shown (e.g. ฿82 → 82, "THB"). If only KRW is shown, currency "KRW".
- amountKrw: when the screen shows the actual charged amount in Korean won (e.g. Naver Pay "7,809원 | 189.00 THB"), put the won amount here. Otherwise null.
- datetime: ISO 8601 local time without timezone, e.g. "2026-11-06T09:32:00". Today's date is ${today}. If the screen shows relative dates ("Yesterday", "어제", "Today"), compute from today and set dateUncertain=true. If only a time or nothing is visible, set datetime=null and dateUncertain=true. The trip spans ${tripStart} to ${tripEnd}; use that to resolve years if missing.
- category: FOOD (restaurants, cafes, food delivery, groceries), TRANSPORT (rides, taxis, fuel, transit), LODGING (hotels, rent), SIGHTSEEING (tickets, tours, activities), SHOPPING (clothes, souvenirs, ceramics, retail), ETC (convenience stores, SIM, services, unknown). Grab food → FOOD. Bolt / Grab ride → TRANSPORT. For Naver Pay, infer from the merchant name; if unsure use ETC with low confidence.
- categoryConfidence: 0..1
- place: area or address fragment if shown (e.g. "Behind CMU, Suthep"), else "".
- note: short Korean note such as "Grab 배달" / "Bolt 탑승" / "네이버페이", plus anything useful (e.g. item count).
Local currency of the trip: ${localCurrency}. Base currency: ${baseCurrency}.
Return JSON only.`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let modelCache = null // 사용 가능한 flash 모델 목록 (인스턴스당 1회)
async function listFlashModels() {
  if (modelCache) return modelCache
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}&pageSize=100`, { signal: AbortSignal.timeout(5000) })
    const j = await r.json()
    const names = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /flash/i.test(m.name) && !/tts|audio|image|live|embedding/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''))
    // 최신(이름 내림차순) 우선, 'lite' 는 뒤로
    names.sort((a, b) => (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0) || b.localeCompare(a, undefined, { numeric: true }))
    modelCache = names
  } catch { modelCache = [] }
  return modelCache
}

async function callModel(model, body, deadline) {
  const left = deadline - Date.now(); if (left < 3000) throw Object.assign(new Error('시간 초과'), { code: 'TIMEOUT' })
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(left, 40000)),
  })
  if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error(`Gemini ${r.status}: ${t.slice(0, 160)}`), { status: r.status }) }
  return r.json()
}

/** images: [{ mime, data(base64) }] → items[] */
export async function extractExpenses(images, ctx) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다')
  const parts = [{ text: prompt(ctx) }]
  for (const im of images) parts.push({ inline_data: { mime_type: im.mime || 'image/jpeg', data: im.data } })
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, response_mime_type: 'application/json', response_schema: SCHEMA },
  }
  const deadline = Date.now() + 48000
  // 후보: 설정 모델 → 사용 가능한 다른 flash 모델들. 503/429/404 면 다음으로.
  const candidates = [MODEL]
  let j = null, lastErr = null
  for (let ci = 0; ci < candidates.length && !j; ci++) {
    const model = candidates[ci]
    for (let attempt = 0; attempt < 2 && !j; attempt++) {
      try { j = await callModel(model, body, deadline); if (ci > 0 || attempt > 0) console.log(`[vision] ok with ${model} (attempt ${attempt + 1})`) }
      catch (e) {
        lastErr = e
        if (e.code === 'TIMEOUT') break
        const st = e.status
        console.warn(`[vision] ${model} attempt ${attempt + 1} failed: ${e.message}`)
        if (st === 503 || st === 429) { if (attempt === 0) await sleep(1500); continue }
        if (st === 404 || st === 400) break // 모델 없음 → 다음 후보
        break
      }
    }
    if (!j && ci === candidates.length - 1 && candidates.length === 1) {
      // 설정 모델 실패 → 다른 flash 모델 후보 추가
      for (const m of await listFlashModels()) if (!candidates.includes(m)) candidates.push(m)
    }
    if (lastErr?.code === 'TIMEOUT') break
  }
  if (!j) {
    const st = lastErr?.status
    if (lastErr?.code === 'TIMEOUT' || lastErr?.name === 'TimeoutError') throw new Error('모델 응답이 너무 늦어요. 잠시 후 다시 시도해주세요')
    if (st === 503 || st === 429) throw new Error('지금 모델이 혼잡해요. 1~2분 뒤 다시 시도해주세요')
    throw new Error(lastErr?.message || '모델 호출 실패')
  }
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}'
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error('모델 응답을 해석할 수 없습니다') }
  return (parsed.items || []).map(normalize).filter(Boolean)
}

function normalize(it) {
  const amountLocal = Number(it.amountLocal)
  if (!Number.isFinite(amountLocal) || amountLocal <= 0) return null
  const currency = String(it.currency || '').toUpperCase().replace('฿', 'THB').replace('₩', 'KRW') || 'THB'
  const dt = typeof it.datetime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(it.datetime) ? it.datetime.slice(0, 19) : null
  return {
    source: SOURCES.includes(it.source) ? it.source : 'other',
    merchant: String(it.merchant || '').trim().slice(0, 80),
    amountLocal: Math.round(amountLocal * 100) / 100,
    currency,
    amountKrw: Number.isFinite(Number(it.amountKrw)) && Number(it.amountKrw) > 0 ? Math.round(Number(it.amountKrw)) : null,
    datetime: dt ? (dt.length === 10 ? dt + 'T12:00:00' : dt.length === 16 ? dt + ':00' : dt) : null,
    dateUncertain: !!it.dateUncertain || !dt,
    category: CATEGORIES.includes(it.category) ? it.category : 'ETC',
    categoryConfidence: Math.max(0, Math.min(1, Number(it.categoryConfidence) || 0)),
    place: String(it.place || '').trim().slice(0, 80),
    note: String(it.note || '').trim().slice(0, 80),
  }
}

/** 중복 방지 키: 출처+가맹점+금액+날짜(시각 제외) */
export function importKeyOf(it) {
  const d = (it.datetime || '').slice(0, 10)
  return createHash('sha1').update(`${it.source}|${it.merchant.toLowerCase()}|${it.amountLocal}|${it.currency}|${d}`).digest('hex').slice(0, 20)
}
