import { create } from 'zustand'
import { api, ApiError, getToken, setToken } from '../lib/api'
import type { Trip, Expense, TripInput, ExpenseInput } from '../types'

type Toast = { id: number; msg: string; kind: 'ok' | 'err' }

interface State {
  authRequired: boolean | null
  authed: boolean
  trips: Trip[]
  expenses: Record<string, Expense[]> // tripId → list
  loading: boolean
  toasts: Toast[]

  init: () => Promise<void>
  login: (pin: string) => Promise<boolean>
  logout: () => void

  loadTrips: () => Promise<void>
  createTrip: (t: TripInput) => Promise<Trip | null>
  updateTrip: (id: string, t: Partial<TripInput>) => Promise<Trip | null>
  deleteTrip: (id: string) => Promise<void>
  recalcTrip: (id: string) => Promise<void>

  loadExpenses: (tripId: string) => Promise<void>
  createExpense: (e: ExpenseInput) => Promise<boolean>
  updateExpense: (id: string, e: Partial<ExpenseInput>) => Promise<boolean>
  deleteExpense: (tripId: string, id: string) => Promise<void>

  toast: (msg: string, kind?: Toast['kind']) => void
}

let toastSeq = 0

export const useStore = create<State>((set, get) => {
  const handle = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { setToken(''); set({ authed: false }); return }
    get().toast(e instanceof Error ? e.message : '오류가 발생했습니다', 'err')
  }
  // 여행 리스트의 합계를 로컬에서 갱신 (서버 재조회 없이)
  const bumpTripTotal = (tripId: string, deltaBase: number, deltaCount: number) =>
    set((s) => ({ trips: s.trips.map((t) => t.id === tripId
      ? { ...t, totalBase: (t.totalBase ?? 0) + deltaBase, expenseCount: (t.expenseCount ?? 0) + deltaCount } : t) }))

  return {
    authRequired: null, authed: false, trips: [], expenses: {}, loading: false, toasts: [],

    async init() {
      try {
        const { required } = await api.authStatus()
        const authed = !required || !!getToken()
        set({ authRequired: required, authed })
        if (authed) await get().loadTrips()
      } catch (e) { handle(e) }
    },
    async login(pin) {
      try {
        const { token } = await api.login(pin)
        setToken(token); set({ authed: true })
        await get().loadTrips()
        return true
      } catch (e) { handle(e); return false }
    },
    logout() { setToken(''); set({ authed: false, trips: [], expenses: {} }) },

    async loadTrips() {
      set({ loading: true })
      try { set({ trips: await api.listTrips() }) } catch (e) { handle(e) } finally { set({ loading: false }) }
    },
    async createTrip(t) {
      try {
        const trip = await api.createTrip(t)
        set((s) => ({ trips: [{ ...trip, totalBase: 0, expenseCount: 0 }, ...s.trips] }))
        get().toast('여행을 만들었어요')
        return trip
      } catch (e) { handle(e); return null }
    },
    async updateTrip(id, t) {
      try {
        const trip = await api.updateTrip(id, t)
        set((s) => ({ trips: s.trips.map((x) => (x.id === id ? { ...x, ...trip } : x)) }))
        return trip
      } catch (e) { handle(e); return null }
    },
    async deleteTrip(id) {
      try {
        await api.deleteTrip(id)
        set((s) => { const ex = { ...s.expenses }; delete ex[id]; return { trips: s.trips.filter((x) => x.id !== id), expenses: ex } })
        get().toast('여행을 삭제했어요')
      } catch (e) { handle(e) }
    },
    async recalcTrip(id) {
      try {
        const list = await api.recalcTrip(id)
        set((s) => ({ expenses: { ...s.expenses, [id]: list } }))
        await get().loadTrips()
        get().toast('현재 환율로 전체 재계산했어요')
      } catch (e) { handle(e) }
    },

    async loadExpenses(tripId) {
      try { const list = await api.listExpenses(tripId); set((s) => ({ expenses: { ...s.expenses, [tripId]: list } })) }
      catch (e) { handle(e) }
    },
    async createExpense(e) {
      try {
        const saved = await api.createExpense(e)
        set((s) => ({ expenses: { ...s.expenses, [e.tripId]: [saved, ...(s.expenses[e.tripId] ?? [])] } }))
        bumpTripTotal(e.tripId, saved.amountBase, 1)
        return true
      } catch (err) { handle(err); return false }
    },
    async updateExpense(id, e) {
      try {
        const saved = await api.updateExpense(id, e)
        set((s) => {
          const list = s.expenses[saved.tripId] ?? []
          const prev = list.find((x) => x.id === id)
          if (prev) bumpTripTotal(saved.tripId, saved.amountBase - prev.amountBase, 0)
          return { expenses: { ...s.expenses, [saved.tripId]: list.map((x) => (x.id === id ? saved : x)) } }
        })
        return true
      } catch (err) { handle(err); return false }
    },
    async deleteExpense(tripId, id) {
      try {
        const prev = (get().expenses[tripId] ?? []).find((x) => x.id === id)
        await api.deleteExpense(id)
        set((s) => ({ expenses: { ...s.expenses, [tripId]: (s.expenses[tripId] ?? []).filter((x) => x.id !== id) } }))
        if (prev) bumpTripTotal(tripId, -prev.amountBase, -1)
        get().toast('삭제했어요')
      } catch (e) { handle(e) }
    },

    toast(msg, kind = 'ok') {
      const id = ++toastSeq
      set((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }))
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2200)
    },
  }
})
