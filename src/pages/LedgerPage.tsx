import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { Button, Card, Empty, ProgressBar } from '../components/ui'
import { ExpenseForm } from '../components/ExpenseForm'
import { ImportSheet } from '../components/ImportSheet'
import { TripForm } from '../components/TripForm'
import { TripHeader } from '../components/TripHeader'
import { CATEGORY_META, PAYMENT_META, SOURCE_META, type Expense, type Trip } from '../types'
import { dateKey, fmtDate, fmtMoney, fmtTime, todayKey, tripDays, dayNumber, tripStatus } from '../lib/format'
import dayjs from 'dayjs'

const PREP = 'PREP'
const prevDay = (d: string) => dayjs(d).subtract(1, 'day').format('YYYY-MM-DD')

function ExpenseRow({ e, trip, onClick }: { e: Expense; trip: Trip; onClick: () => void }) {
  const m = CATEGORY_META[e.category]
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: m.bg }}>{m.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{e.memo || e.place || m.label}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
          <span>{fmtTime(e.spentAt)}</span>
          <span>·</span><span>{m.label}</span>
          {e.place && e.memo && <><span>·</span><span className="truncate">{e.place}</span></>}
          <span className="ml-0.5 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500">{PAYMENT_META[e.paymentMethod].label}</span>
          {e.source && e.source !== 'manual' && <span className="rounded px-1.5 py-px text-[10px] font-bold text-white" style={{ background: SOURCE_META[e.source].color }}>{SOURCE_META[e.source].label}</span>}
        </p>
      </div>
      <div className="tnum shrink-0 text-right">
        {e.currency === trip.localCurrency ? (
          <>
            <p className="text-[15px] font-bold">{fmtMoney(e.amountLocal, trip.localCurrency)}</p>
            <p className="text-xs text-slate-400">≈ {fmtMoney(e.amountBase, trip.baseCurrency)}</p>
          </>
        ) : (
          <>
            <p className="text-[15px] font-bold">{fmtMoney(e.amountBase, trip.baseCurrency)}</p>
            <p className="text-xs text-slate-400">≈ {fmtMoney(e.amountLocal, trip.localCurrency)}</p>
          </>
        )}
      </div>
    </button>
  )
}

export function LedgerPage({ trip }: { trip: Trip }) {
  const { expenses, loadExpenses, createExpense, updateExpense, deleteExpense, updateTrip, deleteTrip, importStatus, loadImportStatus, requestImport, loadTrips, toast } = useStore()
  const list = expenses[trip.id]
  const days = useMemo(() => tripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const status = tripStatus(trip.startDate, trip.endDate)
  const [selected, setSelected] = useState<string>(() => (status === 'ongoing' ? todayKey() : 'ALL'))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [editTrip, setEditTrip] = useState(false)
  const [importing, setImporting] = useState(false)
  const tabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (!list) loadExpenses(trip.id) }, [trip.id, list, loadExpenses])
  useEffect(() => { if (!importStatus) loadImportStatus() }, [importStatus, loadImportStatus])
  useEffect(() => {
    const box = tabsRef.current; const el = box?.querySelector<HTMLElement>('[data-active="true"]')
    if (!box || !el) return
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
    box.scrollTo({ left: box.scrollLeft + (r.left - b.left) - b.width / 2 + r.width / 2, behavior: 'auto' })
  }, [selected, list])

  const all = useMemo(() => [...(list ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [list])
  // 시작일 이전 지출은 날짜와 무관하게 '여행준비' 한 묶음
  const keyOf = (e: Expense) => { const k = dateKey(e.spentAt); return k < trip.startDate ? PREP : k }
  const total = all.reduce((s, e) => s + e.amountBase, 0)
  const todayTotal = all.filter((e) => dateKey(e.spentAt) === todayKey()).reduce((s, e) => s + e.amountBase, 0)
  const visible = selected === 'ALL' ? all : all.filter((e) => keyOf(e) === selected)
  const visibleTotal = visible.reduce((s, e) => s + e.amountBase, 0)
  const byDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of all) m.set(keyOf(e), (m.get(keyOf(e)) ?? 0) + e.amountBase)
    return m
  }, [all])
  // 전체 보기일 때 날짜별 그룹
  const groups = useMemo(() => {
    const g = new Map<string, Expense[]>()
    for (const e of visible) { const k = keyOf(e); g.set(k, [...(g.get(k) ?? []), e]) }
    return [...g.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }, [visible])

  function ImportButton() {
    if (!importStatus) return null
    if (importStatus.allowed) return (
      <Button variant="soft" className="w-full py-2.5" onClick={() => setImporting(true)}>📷 캡처로 가져오기 <span className="font-normal text-brand-500/80">· 네이버페이 · Grab · Bolt</span></Button>
    )
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
        <span>📷 캡처로 가져오기는 승인된 계정만 쓸 수 있어요</span>
        {importStatus.requested
          ? <span className="shrink-0 font-semibold text-slate-400">요청됨</span>
          : <button onClick={() => requestImport('')} className="shrink-0 font-semibold text-brand-600">사용 요청</button>}
      </div>
    )
  }

  const elapsedDays = status === 'done' ? days.length : Math.max(1, Math.min(days.length, dayNumber(trip.startDate, todayKey())))
  const remainBudget = trip.budget != null ? trip.budget - total : null
  const remainDays = Math.max(0, days.length - elapsedDays)
  const hasPrep = byDay.has(PREP)
  const extraDays = all.map(keyOf).filter((d) => d !== PREP && !days.includes(d))
  const allDays = [...days, ...[...new Set(extraDays)].sort()]

  return (
    <div className="mx-auto w-full max-w-5xl pb-28">
      <TripHeader trip={trip} active="ledger" onEdit={() => setEditTrip(true)} onDelete={async () => { if (confirm(`'${trip.title}' 여행과 모든 지출을 삭제할까요?`)) { await deleteTrip(trip.id); location.hash = '#/' } }} />

      <div className="px-4 pt-3 lg:grid lg:grid-cols-[320px_1fr] lg:gap-5 lg:pt-5">
        {/* 요약 */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card className="bg-gradient-to-br from-brand-500 to-brand-700 p-5 text-white">
            <p className="text-xs font-medium text-white/75">총 지출</p>
            <p className="tnum mt-0.5 text-3xl font-extrabold tracking-tight">{fmtMoney(total, trip.baseCurrency)}</p>
            <p className="tnum mt-0.5 text-sm text-white/80">≈ {fmtMoney(Math.round(all.reduce((s, e) => s + (e.currency === trip.localCurrency ? e.amountLocal : e.amountBase / (e.exchangeRate || trip.exchangeRate)), 0)), trip.localCurrency)} · {all.length}건</p>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/15 pt-3 text-sm">
              <div><p className="text-xs text-white/70">오늘</p><p className="tnum font-bold">{fmtMoney(todayTotal, trip.baseCurrency)}</p></div>
              <div><p className="text-xs text-white/70">하루 평균</p><p className="tnum font-bold">{fmtMoney(total / elapsedDays, trip.baseCurrency)}</p></div>
            </div>
            {remainBudget != null && (
              <div className="mt-4 border-t border-white/15 pt-3">
                <div className="flex items-end justify-between text-sm">
                  <div><p className="text-xs text-white/70">남은 예산</p><p className={`tnum font-bold ${remainBudget < 0 ? 'text-amber-200' : ''}`}>{fmtMoney(remainBudget, trip.baseCurrency)}</p></div>
                  {remainDays > 0 && remainBudget > 0 && <p className="tnum text-right text-xs text-white/80">남은 {remainDays}일 · 하루 {fmtMoney(remainBudget / remainDays, trip.baseCurrency)} 가능</p>}
                </div>
                <div className="mt-2 [&>div]:bg-white/25 [&>div>div]:bg-white"><ProgressBar ratio={total / (trip.budget || 1)} danger={remainBudget < 0} /></div>
              </div>
            )}
          </Card>
          <div className="mt-3 hidden lg:block"><Button className="w-full py-3" onClick={() => setAdding(true)}>+ 지출 추가</Button></div>
          {importStatus?.enabled && <div className="mt-2 hidden lg:block"><ImportButton /></div>}
        </div>

        <div className="mt-4 min-w-0 lg:mt-0">
          {importStatus?.enabled && <div className="mb-3 lg:hidden"><ImportButton /></div>}
          {/* 날짜 탭 */}
          <div ref={tabsRef} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <DayTab label="전체" sub={fmtMoney(total, trip.baseCurrency, { compact: true })} active={selected === 'ALL'} onClick={() => setSelected('ALL')} />
            {hasPrep && <DayTab label="여행준비" sub="시작 전" active={selected === PREP} amount={byDay.get(PREP)} onClick={() => setSelected(PREP)} />}
            {allDays.map((d, i) => (
              <DayTab key={d} label={i < days.length ? `Day ${i + 1}` : '기간 외'} sub={fmtDate(d, 'M/D (dd)')} active={selected === d} today={d === todayKey()}
                amount={byDay.get(d)} onClick={() => setSelected(d)} />
            ))}
          </div>

          {/* 리스트 */}
          <div className="mt-3">
            {list === undefined && <p className="py-10 text-center text-slate-400">불러오는 중…</p>}
            {list && visible.length === 0 && (
              <Empty icon="🧾" title={selected === 'ALL' ? '아직 기록이 없어요' : selected === PREP ? '여행준비 기록이 없어요' : '이 날은 기록이 없어요'} desc="아래 + 버튼으로 첫 지출을 추가해보세요" />
            )}
            {groups.map(([day, items]) => (
              <Card key={day} className="mb-3 overflow-hidden">
                <div className="flex items-center justify-between bg-slate-50/70 px-4 py-2 text-xs font-semibold text-slate-500">
                  <span>{day === PREP ? '여행준비' : `${days.includes(day) ? `Day ${dayNumber(trip.startDate, day)} · ` : ''}${fmtDate(day, 'M월 D일 (dd)')}`}</span>
                  <span className="tnum">{fmtMoney(items.reduce((s, e) => s + e.amountBase, 0), trip.baseCurrency)}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((e) => <ExpenseRow key={e.id} e={e} trip={trip} onClick={() => setEditing(e)} />)}
                </div>
              </Card>
            ))}
            {selected !== 'ALL' && visible.length > 0 && (
              <p className="tnum px-1 pr-20 text-right text-sm text-slate-500 lg:pr-1">{selected === PREP ? '여행준비' : '이 날'} 합계 <b className="text-slate-800">{fmtMoney(visibleTotal, trip.baseCurrency)}</b></p>
            )}
          </div>
        </div>
      </div>

      <button onClick={() => setAdding(true)} aria-label="지출 추가"
        style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }} className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-3xl text-white shadow-lg shadow-brand-500/40 active:scale-95 lg:hidden">+</button>

      {importing && <ImportSheet trip={trip} open onClose={() => setImporting(false)}
        onSaved={async (n, errors) => {
          await loadExpenses(trip.id); await loadTrips()
          if (n) { setSelected('ALL'); toast(errors.length ? `${n}건 가져왔어요 · ${errors.length}건 실패` : `${n}건 가져왔어요`, errors.length ? 'err' : 'ok') }
        }} />}
      {adding && <ExpenseForm trip={trip} open onClose={() => setAdding(false)} defaultDate={selected === 'ALL' ? (status === 'ongoing' ? todayKey() : trip.startDate) : selected === PREP ? prevDay(trip.startDate) : selected} onSubmit={createExpense} />}
      {editing && <ExpenseForm trip={trip} open initial={editing} onClose={() => setEditing(null)}
        onSubmit={(e) => updateExpense(editing.id, e)} onDelete={() => deleteExpense(trip.id, editing.id)} />}
      {editTrip && <TripForm open initial={trip} onClose={() => setEditTrip(false)} onSubmit={async (t) => { if (await updateTrip(trip.id, t)) setEditTrip(false) }} />}
    </div>
  )
}

function DayTab({ label, sub, amount, active, today, onClick }:
  { label: string; sub: string; amount?: number; active: boolean; today?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} data-active={active}
      className={`flex shrink-0 flex-col items-start rounded-xl px-3 py-2 text-left transition ${active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
      <span className="text-[13px] font-bold leading-tight">{label}{today && <span className={`ml-1 rounded px-1 text-[9px] ${active ? 'bg-white/20' : 'bg-brand-50 text-brand-600'}`}>오늘</span>}</span>
      <span className={`text-[11px] ${active ? 'text-white/70' : 'text-slate-400'}`}>{sub}{amount ? ` · ${fmtMoney(amount, 'KRW', { compact: true })}` : ''}</span>
    </button>
  )
}
