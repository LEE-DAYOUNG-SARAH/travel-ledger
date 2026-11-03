export type Category = 'FOOD' | 'TRANSPORT' | 'LODGING' | 'SIGHTSEEING' | 'SHOPPING' | 'ETC'
export type PaymentMethod = 'CASH' | 'CARD'

export interface Trip {
  id: string
  title: string
  countryCode: string
  city: string
  startDate: string // YYYY-MM-DD
  endDate: string
  localCurrency: string // THB
  baseCurrency: string // KRW
  exchangeRate: number // 1 local = ? base
  budget: number | null // base currency
  createdAt: string
  updatedAt: string
  // list 응답에만 포함
  totalBase?: number
  expenseCount?: number
}

export interface Expense {
  id: string
  tripId: string
  amountLocal: number
  amountBase: number
  currency: string
  category: Category
  paymentMethod: PaymentMethod
  exchangeRate: number | null // 저장 시점 환율 (1 local = ? base)
  memo: string
  place: string
  spentAt: string // ISO datetime (local)
  createdAt: string
  updatedAt: string
}

export type TripInput = Omit<Trip, 'id' | 'createdAt' | 'updatedAt' | 'totalBase' | 'expenseCount'>
export type ExpenseInput = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>

export const CATEGORY_META: Record<Category, { label: string; icon: string; color: string; bg: string }> = {
  // 색 순서는 색각이상(CVD) 분리 검증을 통과한 고정 순서 — 바꾸지 말 것
  FOOD:        { label: '식비',  icon: '🍜', color: '#e85d04', bg: '#fff3e8' },
  TRANSPORT:   { label: '교통',  icon: '🚕', color: '#1d7fd1', bg: '#e9f3fc' },
  LODGING:     { label: '숙박',  icon: '🏨', color: '#1a9a6c', bg: '#e6f6f0' },
  SIGHTSEEING: { label: '관광',  icon: '🎟️', color: '#7a4fe0', bg: '#f1ecfc' },
  ETC:         { label: '기타',  icon: '📎', color: '#b58900', bg: '#fbf3dc' },
  SHOPPING:    { label: '쇼핑',  icon: '🛍️', color: '#d1337a', bg: '#fbe9f1' },
}
export const CATEGORIES = Object.keys(CATEGORY_META) as Category[]

export const PAYMENT_META: Record<PaymentMethod, { label: string; icon: string }> = {
  CASH: { label: '현금', icon: '💵' },
  CARD: { label: '카드', icon: '💳' },
}

export interface CountryOption { code: string; name: string; currency: string; flag: string }
export const COUNTRIES: CountryOption[] = [
  { code: 'TH', name: '태국', currency: 'THB', flag: '🇹🇭' },
  { code: 'JP', name: '일본', currency: 'JPY', flag: '🇯🇵' },
  { code: 'VN', name: '베트남', currency: 'VND', flag: '🇻🇳' },
  { code: 'TW', name: '대만', currency: 'TWD', flag: '🇹🇼' },
  { code: 'US', name: '미국', currency: 'USD', flag: '🇺🇸' },
  { code: 'EU', name: '유럽(유로)', currency: 'EUR', flag: '🇪🇺' },
  { code: 'GB', name: '영국', currency: 'GBP', flag: '🇬🇧' },
  { code: 'CN', name: '중국', currency: 'CNY', flag: '🇨🇳' },
  { code: 'HK', name: '홍콩', currency: 'HKD', flag: '🇭🇰' },
  { code: 'SG', name: '싱가포르', currency: 'SGD', flag: '🇸🇬' },
  { code: 'MY', name: '말레이시아', currency: 'MYR', flag: '🇲🇾' },
  { code: 'ID', name: '인도네시아', currency: 'IDR', flag: '🇮🇩' },
  { code: 'PH', name: '필리핀', currency: 'PHP', flag: '🇵🇭' },
  { code: 'AU', name: '호주', currency: 'AUD', flag: '🇦🇺' },
  { code: 'KR', name: '한국', currency: 'KRW', flag: '🇰🇷' },
]

export const CURRENCY_SYMBOL: Record<string, string> = {
  KRW: '₩', THB: '฿', JPY: '¥', USD: '$', EUR: '€', GBP: '£', CNY: '¥', HKD: 'HK$', SGD: 'S$',
  TWD: 'NT$', VND: '₫', MYR: 'RM', IDR: 'Rp', PHP: '₱', AUD: 'A$',
}
