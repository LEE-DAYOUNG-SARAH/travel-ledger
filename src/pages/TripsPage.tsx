import { useState } from 'react'
import { useStore } from '../store/useStore'
import { Button, Card, Empty, ProgressBar } from '../components/ui'
import { TripForm } from '../components/TripForm'
import { COUNTRIES, type Trip } from '../types'
import { fmtMoney, fmtDate, tripStatus, daysUntil, dayNumber, todayKey, tripDays } from '../lib/format'
import { navigate } from '../lib/router'

function TripCard({ t, featured }: { t: Trip; featured?: boolean }) {
  const st = tripStatus(t.startDate, t.endDate)
  const flag = COUNTRIES.find((c) => c.code === t.countryCode)?.flag ?? '🌏'
  const total = t.totalBase ?? 0
  const days = tripDays(t.startDate, t.endDate).length
  const badge = st === 'ongoing' ? `Day ${dayNumber(t.startDate, todayKey())} / ${days}`
    : st === 'upcoming' ? `D-${daysUntil(t.startDate)}` : '여행 완료'
  const ratio = t.budget ? total / t.budget : 0

  return (
    <Card onClick={() => navigate({ name: 'ledger', tripId: t.id })}
      className={`p-5 ${featured ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl leading-none">{flag}</span>
            <h3 className="truncate text-lg font-bold">{t.title}</h3>
          </div>
          <p className={`mt-1 text-sm ${featured ? 'text-white/80' : 'text-slate-500'}`}>
            {t.city && `${t.city} · `}{fmtDate(t.startDate, 'YYYY.M.D')} – {fmtDate(t.endDate, 'M.D')}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${featured ? 'bg-white/20' : st === 'done' ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-700'}`}>{badge}</span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className={`text-xs ${featured ? 'text-white/70' : 'text-slate-400'}`}>총 지출 · {t.expenseCount ?? 0}건</p>
          <p className="tnum text-2xl font-extrabold tracking-tight">{fmtMoney(total, t.baseCurrency)}</p>
        </div>
        {t.budget != null && t.budget > 0 && (
          <p className={`tnum text-right text-xs ${featured ? 'text-white/80' : 'text-slate-500'}`}>
            예산 {fmtMoney(t.budget, t.baseCurrency)}<br />
            <span className={`font-bold ${ratio > 1 ? (featured ? 'text-amber-200' : 'text-red-500') : ''}`}>{Math.round(ratio * 100)}% 사용</span>
          </p>
        )}
      </div>
      {t.budget != null && t.budget > 0 && (
        <div className={`mt-3 ${featured ? '[&>div]:bg-white/25 [&>div>div]:bg-white' : ''}`}><ProgressBar ratio={ratio} danger={ratio > 1} /></div>
      )}
    </Card>
  )
}

export function TripsPage() {
  const { trips, loading, createTrip } = useStore()
  const [open, setOpen] = useState(false)
  const ongoing = trips.filter((t) => tripStatus(t.startDate, t.endDate) === 'ongoing')
  const upcoming = trips.filter((t) => tripStatus(t.startDate, t.endDate) === 'upcoming')
  const done = trips.filter((t) => tripStatus(t.startDate, t.endDate) === 'done')

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 pt-safe-4 sm:pt-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">여행 가계부</h1>
          <p className="mt-0.5 text-sm text-slate-500">여행별로 지출을 기록하고 원화로 한눈에</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate({ name: 'settings' })} aria-label="설정">⚙️</Button>
          <div className="hidden sm:block"><Button onClick={() => setOpen(true)} className="whitespace-nowrap">+ 새 여행</Button></div>
        </div>
      </header>

      {loading && trips.length === 0 && <p className="py-10 text-center text-slate-400">불러오는 중…</p>}

      {!loading && trips.length === 0 && (
        <Empty icon="🧳" title="아직 여행이 없어요" desc="첫 여행을 만들고 지출을 기록해보세요"
          action={<Button onClick={() => setOpen(true)}>+ 첫 여행 만들기</Button>} />
      )}

      {ongoing.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-2.5 px-1 text-xs font-bold uppercase tracking-wider text-slate-400">여행 중</h2>
          <div className="grid gap-3 sm:grid-cols-2">{ongoing.map((t) => <TripCard key={t.id} t={t} featured />)}</div>
        </section>
      )}
      {upcoming.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-2.5 px-1 text-xs font-bold uppercase tracking-wider text-slate-400">다가오는 여행</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{upcoming.map((t) => <TripCard key={t.id} t={t} />)}</div>
        </section>
      )}
      {done.length > 0 && (
        <section>
          <h2 className="mb-2.5 px-1 text-xs font-bold uppercase tracking-wider text-slate-400">지난 여행</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{done.map((t) => <TripCard key={t.id} t={t} />)}</div>
        </section>
      )}

      {/* mobile FAB */}
      <button onClick={() => setOpen(true)} aria-label="새 여행"
        style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }} className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-3xl text-white shadow-lg shadow-brand-500/40 active:scale-95 sm:hidden">+</button>

      {open && <TripForm open onClose={() => setOpen(false)} onSubmit={async (t) => { const trip = await createTrip(t); if (trip) { setOpen(false); navigate({ name: 'ledger', tripId: trip.id }) } }} />}
    </div>
  )
}
