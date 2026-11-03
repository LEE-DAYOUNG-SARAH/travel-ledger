import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts'
import { useStore } from '../store/useStore'
import { Card, Empty, Segmented } from '../components/ui'
import { TripHeader } from '../components/TripHeader'
import { TripForm } from '../components/TripForm'
import { CATEGORIES, CATEGORY_META, PAYMENT_META, type PaymentMethod, type Trip } from '../types'
import { dateKey, fmtDate, fmtMoney, tripDays, dayNumber, todayKey, tripStatus } from '../lib/format'

export function StatsPage({ trip }: { trip: Trip }) {
  const { expenses, loadExpenses, updateTrip, deleteTrip } = useStore()
  const list = expenses[trip.id]
  const [editTrip, setEditTrip] = useState(false)
  const [mode, setMode] = useState<'base' | 'local'>('base')
  useEffect(() => { if (!list) loadExpenses(trip.id) }, [trip.id, list, loadExpenses])

  const all = list ?? []
  const cur = mode === 'base' ? trip.baseCurrency : trip.localCurrency
  const amt = (e: { amountBase: number; amountLocal: number; currency: string; exchangeRate: number | null }) =>
    mode === 'base' ? e.amountBase : (e.currency === trip.localCurrency ? e.amountLocal : e.amountBase / (e.exchangeRate || trip.exchangeRate))
  const total = all.reduce((s, e) => s + amt(e), 0)

  const byCat = useMemo(() => CATEGORIES.map((c) => ({
    key: c, name: CATEGORY_META[c].label, color: CATEGORY_META[c].color,
    value: all.filter((e) => e.category === c).reduce((s, e) => s + amt(e), 0),
    count: all.filter((e) => e.category === c).length,
  })).filter((x) => x.value > 0), [all, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => tripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const status = tripStatus(trip.startDate, trip.endDate)
  const shownDays = status === 'ongoing' ? days.slice(0, Math.max(1, dayNumber(trip.startDate, todayKey()))) : days
  const byDay = useMemo(() => shownDays.map((d, i) => ({
    day: `D${i + 1}`, date: fmtDate(d, 'M/D'),
    value: all.filter((e) => dateKey(e.spentAt) === d).reduce((s, e) => s + amt(e), 0),
  })), [all, shownDays, mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const perDayBudget = trip.budget ? (mode === 'base' ? trip.budget : trip.budget / trip.exchangeRate) / days.length : null
  const avg = byDay.length ? total / byDay.length : 0
  const maxDay = byDay.reduce((m, d) => (d.value > m.value ? d : m), byDay[0] ?? { day: '', date: '', value: 0 })

  const byPay = (Object.keys(PAYMENT_META) as PaymentMethod[]).map((p) => ({
    key: p, label: PAYMENT_META[p].label, icon: PAYMENT_META[p].icon,
    value: all.filter((e) => e.paymentMethod === p).reduce((s, e) => s + amt(e), 0),
  }))

  const tooltipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px -12px rgba(15,23,42,.25)', fontSize: 13 }

  return (
    <div className="mx-auto w-full max-w-5xl pb-16">
      <TripHeader trip={trip} active="stats" onEdit={() => setEditTrip(true)} onDelete={async () => { if (confirm(`'${trip.title}' 여행과 모든 지출을 삭제할까요?`)) { await deleteTrip(trip.id); location.hash = '#/' } }} />

      <div className="px-4 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">총 지출 · {all.length}건</p>
            <p className="tnum text-2xl font-extrabold tracking-tight">{fmtMoney(total, cur)}</p>
          </div>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'base', label: '원화' }, { value: 'local', label: trip.localCurrency }]} />
        </div>

        {list && all.length === 0 && <Empty icon="📊" title="통계를 보려면 지출을 먼저 기록해주세요" />}

        {all.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* 카테고리 */}
            <Card className="p-5">
              <h2 className="font-bold">카테고리별</h2>
              <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row">
                <div className="relative h-48 w-48 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="#fff" strokeWidth={2} cornerRadius={4}>
                        {byCat.map((x) => <Cell key={x.key} fill={x.color} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtMoney(Number(v), cur), '']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[11px] text-slate-400">1위</span>
                    <span className="text-sm font-bold">{byCat[0] ? [...byCat].sort((a, b) => b.value - a.value)[0].name : '-'}</span>
                  </div>
                </div>
                <ul className="w-full flex-1 space-y-2">
                  {[...byCat].sort((a, b) => b.value - a.value).map((x) => (
                    <li key={x.key} className="flex items-center gap-2.5 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.color }} />
                      <span className="w-14 shrink-0 whitespace-nowrap font-semibold">{CATEGORY_META[x.key].icon} {x.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(x.value / total) * 100}%`, background: x.color }} /></div>
                      <span className="tnum w-9 shrink-0 text-right text-xs text-slate-500">{Math.round((x.value / total) * 100)}%</span>
                      <span className="tnum w-24 shrink-0 text-right font-semibold">{fmtMoney(x.value, cur)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>

            {/* 결제수단 */}
            <Card className="p-5">
              <h2 className="font-bold">결제수단별</h2>
              <p className="mt-0.5 text-xs text-slate-400">현금 사용량으로 환전 계획을 잡아보세요</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {byPay.map((p) => (
                  <div key={p.key} className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-500">{p.icon} {p.label}</p>
                    <p className="tnum mt-1 text-xl font-extrabold">{fmtMoney(p.value, cur)}</p>
                    <p className="tnum text-xs text-slate-400">{total ? Math.round((p.value / total) * 100) : 0}%</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
                {byPay.map((p, i) => <div key={p.key} className={i === 0 ? 'bg-slate-800' : 'bg-brand-500'} style={{ width: `${total ? (p.value / total) * 100 : 0}%` }} />)}
              </div>
            </Card>

            {/* 일별 */}
            <Card className="p-5 lg:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-bold">일별 지출</h2>
                  <p className="mt-0.5 text-xs text-slate-400">하루 평균 <b className="tnum text-slate-700">{fmtMoney(avg, cur)}</b>{perDayBudget != null && <> · 예산 기준 하루 <b className="tnum text-slate-700">{fmtMoney(perDayBudget, cur)}</b></>}</p>
                </div>
                {maxDay.value > 0 && <p className="text-xs text-slate-500">최다 지출일 <b className="text-slate-700">{maxDay.date}</b> · <span className="tnum font-semibold text-slate-700">{fmtMoney(maxDay.value, cur)}</span></p>}
              </div>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer>
                  <BarChart data={byDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={byDay.length > 20 ? 1 : 4}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={byDay.length > 14 ? Math.ceil(byDay.length / 10) : 0} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44}
                      tickFormatter={(v) => new Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(v)} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={tooltipStyle} formatter={(v) => [fmtMoney(Number(v), cur), '지출']}
                      labelFormatter={(l, p) => `${(p?.[0]?.payload as { day?: string })?.day ?? ''} · ${l}`} />
                    {perDayBudget != null && <ReferenceLine y={perDayBudget} stroke="#d1337a" strokeDasharray="4 4" label={{ value: '일 예산', position: 'insideTopRight', fontSize: 11, fill: '#d1337a' }} />}
                    <Bar dataKey="value" fill="#368fff" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        )}
      </div>
      {editTrip && <TripForm open initial={trip} onClose={() => setEditTrip(false)} onSubmit={async (t) => { if (await updateTrip(trip.id, t)) setEditTrip(false) }} />}
    </div>
  )
}
