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
const noQuota = new Set() // 이 인스턴스에서 429(할당량 없음) 받은 모델
async function listFlashModels() {
  if (modelCache) return modelCache
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}&pageSize=100`, { signal: AbortSignal.timeout(5000) })
    const j = await r.json()
    const names = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /flash/i.test(m.name) && !/tts|audio|image|live|embedding|omni/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''))
    // 빠른(lite) 모델 우선, 그다음 최신순
    names.sort((a, b) => (/lite/.test(b) ? 1 : 0) - (/lite/.test(a) ? 1 : 0) || b.localeCompare(a, undefined, { numeric: true }))
    modelCache = names
  } catch { modelCache = [] }
  return modelCache
}

function makeBody(parts, thinkingOff) {
  const generationConfig = { temperature: 0.1, response_mime_type: 'application/json', response_schema: SCHEMA }
  if (thinkingOff) generationConfig.thinkingConfig = { thinkingBudget: 0 } // 추출 작업엔 불필요, 지연 크게 줄임
  return { contents: [{ role: 'user', parts }], generationConfig }
}

async function callModel(model, parts, deadline) {
  const left = deadline - Date.now(); if (left < 3000) throw Object.assign(new Error('시간 초과'), { code: 'TIMEOUT' })
  const post = async (body) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(deadline - Date.now(), 20000)),
  })
  let r = await post(makeBody(parts, true))
  if (r.status === 400) { const t = await r.text().catch(() => ''); if (/thinking/i.test(t)) r = await post(makeBody(parts, false)); else throw Object.assign(new Error(`Gemini 400: ${t.slice(0, 160)}`), { status: 400 }) }
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    const err = Object.assign(new Error(`Gemini ${r.status}: ${t.slice(0, 160)}`), { status: r.status, quota: r.status === 429 && /quota|billing/i.test(t) })
    throw err
  }
  return r.json()
}

/** 이미지 1장을 모델 후보 순서대로 시도 */
async function extractOne(image, promptText, deadline) {
  const parts = [{ text: promptText }, { inline_data: { mime_type: image.mime || 'image/jpeg', data: image.data } }]
  const candidates = [MODEL]
  let lastErr = null
  for (let ci = 0; ci < candidates.length; ci++) {
    const model = candidates[ci]
    if (noQuota.has(model)) continue
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now()
      try {
        const j = await callModel(model, parts, deadline)
        console.log(`[vision] ${model} ok in ${Date.now() - t0}ms`)
        return j
      } catch (e) {
        lastErr = e
        console.warn(`[vision] ${model} attempt ${attempt + 1} failed after ${Date.now() - t0}ms: ${e.message.slice(0, 120)}`)
        if (e.code === 'TIMEOUT') return { __err: e }
        if (e.quota) { noQuota.add(model); break }            // 할당량 없음 → 재시도 의미 없음
        if (e.status === 503 || e.status === 429) { if (attempt === 0) { await sleep(1200); continue } break }
        break                                                 // 404/400/타임아웃 등 → 다음 모델
      }
    }
    if (ci === candidates.length - 1 && candidates.length < 4) for (const m of await listFlashModels()) if (!candidates.includes(m) && !noQuota.has(m)) candidates.push(m)
  }
  return { __err: lastErr }
}

/** images: [{ mime, data(base64) }] → items[]  — 이미지별 병렬 호출 후 합침 */
export async function extractExpenses(images, ctx) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다')
  const deadline = Date.now() + 50000
  const promptText = prompt(ctx)
  const results = await Promise.all(images.map((im) => extractOne(im, promptText, deadline)))
  const items = [], errors = []
  for (const r of results) {
    if (r.__err) { errors.push(r.__err); continue }
    const text = r?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}'
    try { for (const it of JSON.parse(text).items || []) { const n = normalize(it); if (n) items.push(n) } }
    catch { errors.push(new Error('모델 응답을 해석할 수 없습니다')) }
  }
  if (!items.length && errors.length) {
    const e = errors[0]
    if (e.code === 'TIMEOUT' || e.name === 'TimeoutError' || /timeout|aborted/i.test(e.message)) throw new Error('모델 응답이 너무 늦어요. 캡처를 1~2장씩 나눠서 다시 시도해보세요')
    if (e.quota) throw new Error('이 API 키로 쓸 수 있는 무료 모델 할당량이 없어요. Google AI Studio에서 키/프로젝트 상태를 확인해주세요')
    if (e.status === 503 || e.status === 429) throw new Error('지금 모델이 혼잡해요. 1~2분 뒤 다시 시도해주세요')
    throw new Error(e.message || '모델 호출 실패')
  }
  if (errors.length) console.warn(`[vision] ${errors.length}/${images.length}장 실패 (나머지는 성공)`)
  return items
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
