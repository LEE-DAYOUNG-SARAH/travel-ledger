import { useState } from 'react'
import { COUNTRIES, type Trip } from '../types'
import { fmtDate } from '../lib/format'
import { href } from '../lib/router'

export function TripHeader({ trip, active, onEdit, onDelete }:
  { trip: Trip; active: 'ledger' | 'stats'; onEdit: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false)
  const flag = COUNTRIES.find((c) => c.code === trip.countryCode)?.flag ?? '🌏'
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-100/85 pt-safe backdrop-blur">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <a href="#/" aria-label="여행 목록" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 6l-6 6 6 6" /></svg>
        </a>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold leading-tight">{flag} {trip.title}</h1>
          <p className="truncate text-[11px] text-slate-500">{fmtDate(trip.startDate, "M.D")} – {fmtDate(trip.endDate, "M.D")} · 기본 1 {trip.localCurrency} = {trip.exchangeRate}원</p>
        </div>
        <nav className="inline-flex rounded-xl bg-slate-200/70 p-1">
          <a href={href({ name: 'ledger', tripId: trip.id })} className={`rounded-lg px-3 py-1 text-sm font-semibold ${active === 'ledger' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>가계부</a>
          <a href={href({ name: 'stats', tripId: trip.id })} className={`rounded-lg px-3 py-1 text-sm font-semibold ${active === 'stats' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>통계</a>
        </nav>
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)} aria-label="더보기" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200 animate-fade-in">
                <button className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => { setMenu(false); onEdit() }}>여행 정보 수정</button>
                <a href="#/settings" className="block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50">설정 · 백업</a>
                <button className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50" onClick={() => { setMenu(false); onDelete() }}>여행 삭제</button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
