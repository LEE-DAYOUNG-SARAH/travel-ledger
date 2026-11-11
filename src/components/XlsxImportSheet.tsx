import { useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Button, Sheet } from './ui'
import { api } from '../lib/api'
import { parseLedgerXlsx, rowToExpense, type XlsxTrip } from '../lib/xlsxImport'
import { fmtMoney } from '../lib/format'
import { useStore } from '../store/useStore'
import { COUNTRIES, type Trip } from '../types'

type Plan = { checked: boolean; mode: 'merge' | 'new'; targetId: string | null }

export function XlsxImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { trips, loadTrips, toast } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<XlsxTrip[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [phase, setPhase] = useState<'pick' | 'parsing' | 'review' | 'saving'>('pick')
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')

  // 기존 여행 매칭: 같은 시작일 또는 기간 겹침
  const findMatch = (t: XlsxTrip): Trip | undefined =>
    trips.find((x) => x.startDate === t.startDate) ?? trips.find((x) => x.startDate <= t.endDate && x.endDate >= t.startDate)

  const pick = async (f: File | undefined) => {
    if (!f) return
    setErr(''); setPhase('parsing')
    try {
      const ts = await parseLedgerXlsx(f)
      if (!ts.length) { setErr('여행 시트를 찾지 못했어요. "여행 목록" 시트가 있는 가계부 엑셀 파일인지 확인해주세요'); setPhase('pick'); return }
      const ps: Plan[] = ts.map((t) => {
        const m = findMatch(t)
        return m ? { checked: false, mode: 'merge' as const, targetId: m.id } : { checked: true, mode: 'new' as const, targetId: null }
      })
      setParsed(ts); setPlans(ps); setPhase('review')
    } catch (e) { setErr(e instanceof Error ? e.message : '파일을 읽지 못했어요'); setPhase('pick') }
    finally { if (fileRef.current) fileRef.current.value = '' }
  }

  const summary = useMemo(() => parsed.map((t) => {
    const rows = t.rows
    return { rows, krw: rows.reduce((s, r) => s + r.amountKrw, 0) }
  }), [parsed])

  const save = async () => {
    setPhase('saving'); setErr('')
    let tripsMade = 0, saved = 0, failed = 0
    try {
      for (let i = 0; i < parsed.length; i++) {
        const t = parsed[i], p = plans[i]; if (!p.checked) continue
        let target: Trip | undefined = p.mode === 'merge' && p.targetId ? trips.find((x) => x.id === p.targetId) : undefined
        if (!target) {
          setProgress(`${t.name} 여행 만드는 중…`)
          const created = await api.createTrip({ title: t.name, countryCode: t.countryCode, city: '', startDate: t.startDate, endDate: t.endDate,
            localCurrency: t.localCurrency, baseCurrency: 'KRW', exchangeRate: t.exchangeRate, budget: null })
          target = created; tripsMade++
        }
        const rows = summary[i].rows
        const items = rows.map((r) => rowToExpense(r, target!.id, target!.localCurrency, target!.baseCurrency, target!.exchangeRate))
        for (let j = 0; j < items.length; j += 50) {
          setProgress(`${t.name} · ${Math.min(j + 50, items.length)}/${items.length}건 저장 중…`)
          const r = await api.createExpensesBatch(items.slice(j, j + 50))
          saved += r.saved.length; failed += r.errors.length
        }
      }
      await loadTrips()
      toast(`지출 ${saved}건 가져왔어요${tripsMade ? ` · 여행 ${tripsMade}개 생성` : ''}${failed ? ` · ${failed}건 실패` : ''}`, failed ? 'err' : 'ok')
      onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : '저장 실패'); setPhase('review') }
  }

  const anyChecked = plans.some((p) => p.checked)
  return (
    <Sheet open={open} onClose={onClose} title="📄 엑셀 가져오기"
      footer={phase === 'review' || phase === 'saving'
        ? <div className="flex items-center gap-2">
            <button onClick={() => { setPhase('pick'); setParsed([]) }} className="text-sm text-slate-500">← 다른 파일</button>
            <Button className="ml-auto py-3" onClick={save} disabled={!anyChecked || phase === 'saving'}>{phase === 'saving' ? progress || '저장 중…' : '가져오기'}</Button>
          </div>
        : <Button className="w-full py-3" onClick={() => fileRef.current?.click()} disabled={phase === 'parsing'}>{phase === 'parsing' ? '읽는 중…' : '엑셀 파일 선택'}</Button>}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {phase !== 'review' && phase !== 'saving' && (
        <div className="pt-1 text-sm text-slate-500">
          <p>여행 가계부 앱에서 내보낸 엑셀(.xlsx)을 올리면 여행과 지출을 한 번에 가져와요.</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
            <li>"여행 목록" 시트의 여행마다 새 여행을 만들고, 기간이 겹치는 기존 여행이 있으면 거기에 합쳐요</li>
            <li>이미 앱에 있는 여행은 <b>기본으로 체크 해제</b>돼요 (합치려면 체크)</li>
              <li>합칠 때 중복 검사는 하지 않아요 — <b>엑셀의 모든 행이 그대로 추가</b>되니 겹치는 건 나중에 직접 지워주세요</li>
            <li>"여행 N일차" → 시작일 + N−1, "여행준비" → 시작일 하루 전 날짜로 저장되어 내역의 <b>여행준비</b> 탭에 모여요</li>
            <li>시트의 환율·원화 환산 금액을 그대로 사용, 항공은 교통으로</li>
          </ul>
          {err && <p className="mt-3 font-medium text-red-500">{err}</p>}
        </div>
      )}
      {(phase === 'review' || phase === 'saving') && (
        <ul className="divide-y divide-slate-100 pt-1">
          {parsed.map((t, i) => {
            const p = plans[i], s = summary[i]
            const match = p.targetId ? trips.find((x) => x.id === p.targetId) : undefined
            const flag = COUNTRIES.find((c) => c.code === t.countryCode)?.flag ?? '🌏'
            return (
              <li key={i} className={`py-3 ${p.checked ? '' : 'opacity-50'}`}>
                <label className="flex items-start gap-2.5">
                  <input type="checkbox" checked={p.checked} onChange={(e) => setPlans((ps) => ps.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} className="mt-1 h-5 w-5 accent-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{flag} {t.name}</p>
                    <p className="text-xs text-slate-500">{dayjs(t.startDate).format('YYYY.M.D')} – {dayjs(t.endDate).format('M.D')} · {t.rows.length}건 · {t.localCurrency}{t.localCurrency !== 'KRW' ? ` (1 ${t.localCurrency} = ${t.exchangeRate}원)` : ''}</p>
                    {match && (
                      <select value={p.mode} onChange={(e) => setPlans((ps) => ps.map((x, j) => (j === i ? { ...x, mode: e.target.value as Plan['mode'] } : x)))}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold">
                        <option value="merge">기존 "{match.title}"에 합치기 (전부 추가)</option>
                        <option value="new">새 여행으로 따로 만들기</option>
                      </select>
                    )}
                    <p className="tnum mt-1.5 text-xs text-slate-600">
                      가져올 지출 <b>{s.rows.length}건</b> · {fmtMoney(s.krw, 'KRW')}
                    </p>
                  </div>
                </label>
              </li>
            )
          })}
          {err && <p className="pt-3 text-sm font-medium text-red-500">{err}</p>}
        </ul>
      )}
    </Sheet>
  )
}
