import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { useRoute } from './lib/router'
import { Toasts } from './components/ui'
import { TripsPage } from './pages/TripsPage'
import { LedgerPage } from './pages/LedgerPage'
import { StatsPage } from './pages/StatsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'

export default function App() {
  const { authRequired, authed, trips, loading, init } = useStore()
  const route = useRoute()
  useEffect(() => { init() }, [init])

  let page: React.ReactNode
  if (authRequired === null) page = <p className="py-24 text-center text-slate-400">연결 중…</p>
  else if (!authed) page = <LoginPage />
  else if (route.name === 'settings') page = <SettingsPage />
  else if (route.name === 'ledger' || route.name === 'stats') {
    const trip = trips.find((t) => t.id === route.tripId)
    if (!trip) page = loading || trips.length === 0
      ? <p className="py-24 text-center text-slate-400">불러오는 중…</p>
      : <div className="py-24 text-center text-slate-500">여행을 찾을 수 없어요. <a className="text-brand-600 underline" href="#/">목록으로</a></div>
    else page = route.name === 'ledger' ? <LedgerPage key={trip.id} trip={trip} /> : <StatsPage key={trip.id} trip={trip} />
  } else page = <TripsPage />

  return <div className="min-h-dvh">{page}<Toasts /></div>
}
