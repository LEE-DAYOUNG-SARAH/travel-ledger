import type { Trip, Expense, TripInput, ExpenseInput, User, AuthStatus, ImportedItem } from '../types'

const TOKEN_KEY = 'ledger.token'
export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

export class ApiError extends Error {
  status: number
  constructor(status: number, msg: string) { super(msg); this.status = status }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`./api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).error || msg } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  authStatus: () => req<AuthStatus>('GET', '/auth/status'),
  login: (pin: string) => req<{ token: string; user: User }>('POST', '/auth/login', { pin }),
  loginGoogle: (credential: string) => req<{ token: string; user: User }>('POST', '/auth/google', { credential }),
  me: () => req<User>('GET', '/auth/me'),

  listTrips: () => req<Trip[]>('GET', '/trips'),
  createTrip: (t: TripInput) => req<Trip>('POST', '/trips', t),
  updateTrip: (id: string, t: Partial<TripInput>) => req<Trip>('PUT', `/trips/${id}`, t),
  deleteTrip: (id: string) => req<{ ok: boolean }>('DELETE', `/trips/${id}`),
  recalcTrip: (id: string) => req<Expense[]>('POST', `/trips/${id}/recalc`),

  listExpenses: (tripId: string) => req<Expense[]>('GET', `/trips/${tripId}/expenses`),
  createExpense: (e: ExpenseInput) => req<Expense>('POST', '/expenses', e),
  updateExpense: (id: string, e: Partial<ExpenseInput>) => req<Expense>('PUT', `/expenses/${id}`, e),
  deleteExpense: (id: string) => req<{ ok: boolean }>('DELETE', `/expenses/${id}`),

  importStatus: () => req<{ enabled: boolean; allowed: boolean; requested: boolean; requestedAt: string | null }>('GET', '/import/status'),
  importRequest: (message: string) => req<{ ok: boolean; requested?: boolean; notified?: boolean; throttled?: boolean; notifyConfigured?: boolean }>('POST', '/import/request', { message }),
  importScreenshots: (tripId: string, images: { mime: string; data: string }[], today: string) =>
    req<{ items: ImportedItem[] }>('POST', '/import/screenshots', { tripId, images, today }),
  createExpensesBatch: (items: ExpenseInput[]) => req<{ saved: Expense[]; errors: string[] }>('POST', '/expenses/batch', { items }),
  exportAll: () => req<unknown>('GET', '/export'),
  importAll: (payload: unknown, replace: boolean) => req<{ trips: number; expenses: number }>('POST', `/import?replace=${replace ? 1 : 0}`, payload),
  rate: (from: string, to: string) => req<{ rate: number; updatedAt: string }>('GET', `/rate?from=${from}&to=${to}`),
}
