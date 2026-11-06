import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Button, Sheet, inputCls } from './ui'
import { api } from '../lib/api'
import { compressImage } from '../lib/image'
import { fmtMoney, toBase } from '../lib/format'
import { getLiveRate } from '../lib/rate'
import { CATEGORIES, CATEGORY_META, SOURCE_META, type Category, type ExpenseInput, type ImportedItem, type Trip } from '../types'

type Row = ImportedItem & { checked: boolean; spentAt: string }

export function ImportSheet({ trip, open, onClose, onSaved }:
  { trip: Trip; open: boolean; onClose: () => void; onSaved: (n: number) => Promise<void> | void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<{ mime: string; data: string; preview: string }[]>([])
  const [phase, setPhase] = useState<'pick' | 'analyzing' | 'review' | 'saving'>('pick')
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState('')
  const [done, setDone] = useState(0)
  const [tick, setTick] = useState(0) // 분석 경과 시간(0.1초 단위) — 진행바 애니메이션용
  useEffect(() => { if (phase !== 'analyzing') { setTick(0); return } const id = setInterval(() => setTick((t) => t + 1), 100); return () => clearInterval(id) }, [phase])
  const [rate, setRate] = useState<number>(trip.exchangeRate)
  useEffect(() => { getLiveRate(trip.localCurrency, trip.baseCurrency).then((r) => r && setRate(r.rate)) }, [trip.localCurrency, trip.baseCurrency])

  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    setErr('')
    const list = [...files].slice(0, 3 - images.length)
    try { const out = await Promise.all(list.map((f) => compressImage(f))); setImages((p) => [...p, ...out]) }
    catch { setErr('이미지를 읽지 못했어요') }
    if (fileRef.current) fileRef.current.value = ''
  }

  const analyze = async () => {
    setPhase('analyzing'); setErr(''); setDone(0)
    const today = dayjs().format('YYYY-MM-DD')
    try {
      // 이미지별로 따로 요청 → 끝나는 대로 진행률 반영
      const results = await Promise.all(images.map(async ({ mime, data }) => {
        try { const r = await api.importScreenshots(trip.id, [{ mime, data }], today); return { items: r.items } }
        catch (e) { return { items: [], error: e instanceof Error ? e.message : '분석 실패' } }
        finally { setDone((d) => d + 1) }
      }))
      const items = results.flatMap((r) => r.items)
      const failed = results.filter((r) => r.error)
      if (!items.length) { setErr(failed[0]?.error || '캡처에서 결제 내역을 찾지 못했어요'); setPhase('pick'); return }
      if (failed.length) setErr(`${failed.length}장은 읽지 못했어요 (${failed[0].error})`)
      setRows(items.map((it) => ({ ...it, checked: true, spentAt: it.datetime ? dayjs(it.datetime).format('YYYY-MM-DDTHH:mm') : `${today}T12:00` })))
      setPhase('review')
    } catch (e) { setErr(e instanceof Error ? e.message : '분석 실패'); setPhase('pick') }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const selected = rows.filter((r) => r.checked)

  const toInput = (r: Row): ExpenseInput => {
    const isLocal = r.currency === trip.localCurrency
    // 네이버페이처럼 실제 청구 원화가 있으면 그 값을 쓰고 환율을 역산, 없으면 실시간 환율
    let amountBase: number, exchangeRate: number
    if (isLocal && r.amountKrw) { amountBase = r.amountKrw; exchangeRate = Math.round((r.amountKrw / r.amountLocal) * 10000) / 10000 }
    else if (isLocal) { amountBase = toBase(r.amountLocal, rate, trip.baseCurrency); exchangeRate = rate }
    else { amountBase = r.amountLocal; exchangeRate = rate }
    return {
      tripId: trip.id, amountLocal: isLocal ? r.amountLocal : Math.round((r.amountLocal / rate) * 100) / 100, amountBase,
      currency: isLocal ? trip.localCurrency : trip.baseCurrency, category: r.category, paymentMethod: 'CARD', exchangeRate,
      source: r.source, importKey: r.importKey, memo: r.merchant, place: r.place,
      spentAt: dayjs(r.spentAt).format('YYYY-MM-DDTHH:mm:ss'),
    } as ExpenseInput
  }

  const save = async () => {
    if (!selected.length) return
    setPhase('saving'); setErr('')
    try {
      const { saved, errors } = await api.createExpensesBatch(selected.map(toInput))
      await onSaved(saved.length)
      if (errors.length) setErr(`${errors.length}건은 저장하지 못했어요: ${errors[0]}`)
      if (saved.length) onClose()
      else setPhase('review')
    } catch (e) { setErr(e instanceof Error ? e.message : '저장 실패'); setPhase('review') }
  }

  const total = useMemo(() => selected.reduce((s, r) => s + (r.amountKrw ?? (r.currency === trip.localCurrency ? r.amountLocal * rate : r.amountLocal)), 0), [selected, rate, trip.localCurrency])

  return (
    <Sheet open={open} onClose={onClose} title="📷 캡처로 가져오기"
      footer={phase === 'review' || phase === 'saving'
        ? <div className="flex items-center gap-2">
            <button onClick={() => setPhase('pick')} className="text-sm text-slate-500">← 다시 선택</button>
            <Button className="ml-auto py-3" onClick={save} disabled={!selected.length || phase === 'saving'}>
              {phase === 'saving' ? '저장 중…' : `선택 ${selected.length}건 저장`}{selected.length > 0 && <span className="font-normal opacity-80"> · ≈{fmtMoney(Math.round(total), trip.baseCurrency)}</span>}
            </Button>
          </div>
        : <Button className="w-full py-3" onClick={analyze} disabled={!images.length || phase === 'analyzing'}>
            {phase === 'analyzing' ? '분석 중…' : `${images.length}장 분석하기`}
          </Button>}>
      {phase !== 'review' && phase !== 'saving' && (
        <div className="pt-1">
          <p className="text-sm text-slate-500">네이버페이 결제내역, Grab·Bolt 활동 화면을 캡처해서 올리면 내역을 읽어 분류해요. 한 번에 최대 3장.</p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {images.map((im, i) => (
              <div key={i} className="relative aspect-[9/16] overflow-hidden rounded-xl bg-slate-100">
                <img src={im.preview} alt="" className="h-full w-full object-cover" />
                <button onClick={() => setImages((p) => p.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white">✕</button>
              </div>
            ))}
            {images.length < 3 && (
              <button onClick={() => fileRef.current?.click()} disabled={phase === 'analyzing'}
                className="flex aspect-[9/16] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400">
                <span className="text-3xl">＋</span><span className="text-xs">캡처 추가</span>
              </button>
            )}
          </div>
          {phase === 'analyzing' && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-slate-500"><span>캡처 읽는 중</span><span className="tnum">{done} / {images.length}</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500 transition-all duration-300"
                  style={{ width: `${Math.min(96, Math.max((done / images.length) * 100, (done / images.length) * 100 + (1 / images.length) * 100 * (1 - Math.exp(-tick / 40))))}%` }} />
              </div>
            </div>
          )}
          {err && <p className="mt-3 text-sm font-medium text-red-500">{err}</p>}
        </div>
      )}

      {(phase === 'review' || phase === 'saving') && (
        <div className="pt-1">
          <p className="text-xs text-slate-500">저장할 항목을 체크하세요. 카테고리·날짜·메모는 여기서 바로 고칠 수 있어요.</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {rows.map((r, i) => {
              const sm = SOURCE_META[r.source]
              return (
                <li key={i} className={`py-3 ${r.checked ? '' : 'opacity-60'}`}>
                  <div className="flex items-start gap-2.5">
                    <input type="checkbox" checked={r.checked} onChange={(e) => update(i, { checked: e.target.checked })} className="mt-1 h-5 w-5 shrink-0 accent-brand-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded px-1.5 py-px text-[10px] font-bold text-white" style={{ background: sm.color }}>{sm.label}</span>
                        <input value={r.merchant} onChange={(e) => update(i, { merchant: e.target.value })} className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none" />
                        <span className="tnum shrink-0 text-right">
                          <span className="font-bold">{fmtMoney(r.amountLocal, r.currency)}</span>
                          {r.amountKrw && <span className="block text-[11px] text-slate-400">실청구 {fmtMoney(r.amountKrw, 'KRW')}</span>}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <select value={r.category} onChange={(e) => update(i, { category: e.target.value as Category })}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold">
                          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>)}
                        </select>
                        <input type="datetime-local" value={r.spentAt} onChange={(e) => update(i, { spentAt: e.target.value })}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" />
                      </div>
                      <input value={r.place} onChange={(e) => update(i, { place: e.target.value })} placeholder="장소 (선택)" className={inputCls + ' mt-1.5 py-1 text-xs'} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          {err && <p className="mt-3 text-sm font-medium text-red-500">{err}</p>}
        </div>
      )}
    </Sheet>
  )
}
