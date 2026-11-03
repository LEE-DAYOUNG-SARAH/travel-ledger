import { useEffect, useState } from 'react'

export type Route =
  | { name: 'trips' }
  | { name: 'ledger'; tripId: string }
  | { name: 'stats'; tripId: string }
  | { name: 'settings' }

export function parse(hash: string): Route {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (p[0] === 'trip' && p[1]) return p[2] === 'stats' ? { name: 'stats', tripId: p[1] } : { name: 'ledger', tripId: p[1] }
  if (p[0] === 'settings') return { name: 'settings' }
  return { name: 'trips' }
}
export const href = (r: Route) =>
  r.name === 'trips' ? '#/' : r.name === 'settings' ? '#/settings' : `#/trip/${r.tripId}${r.name === 'stats' ? '/stats' : ''}`
export const navigate = (r: Route) => { location.hash = href(r) }

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(location.hash))
  useEffect(() => {
    const on = () => setRoute(parse(location.hash))
    addEventListener('hashchange', on); return () => removeEventListener('hashchange', on)
  }, [])
  return route
}
