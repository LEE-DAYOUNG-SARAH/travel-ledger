import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Button, Field, Sheet, inputCls, autoFocusOnDesktop } from './ui'
import { CATEGORIES, CATEGORY_META, PAYMENT_META, CURRENCY_SYMBOL, type Category, type Expense, type ExpenseInput, type PaymentMethod, type Trip } from '../types'
import { fmtMoney, toBase, toLocal } from '../lib/format'
import { getLiveRate } from '../lib/rate'

const LAST_PAY_KEY = 'ledger.lastPayment'

export function ExpenseForm({ trip, open, onClose, initial, defaultDate, onSubmit, onDelete }: {
  trip: Trip; open: boolean; onClose: () => void; initial?: Expense | null; defaultDate?: string
  onSubmit: (e: ExpenseInput) => Promise<boolean>; onDelete?: () => Promise<void>
}) {
  const [currency, setCurrency] = useState(initial?.currency ?? trip.localCurrency)
  const [amount, setAmount] = useState(initial ? String(initial.currency === trip.localCurrency ? initial.amountLocal : initial.amountBase) : '')
  const [category, setCategory] = useState<Category>(initial?.category ?? 'FOOD')
  const [payment, setPayment] = useState<PaymentMethod>(initial?.paymentMethod ?? ((localStorage.getItem(LAST_PAY_KEY) as PaymentMethod) || 'CASH'))
  const [memo, setMemo] = useState(initial?.memo ?? '')
  const [place, setPlace] = useState(initial?.place ?? '')
  const [spentAt, setSpentAt] = useState(initial ? dayjs(initial.spentAt).format('YYYY-MM-DDTHH:mm')
    : `${defaultDate ?? dayjs().format('YYYY-MM-DD')}T${dayjs().format('HH:mm')}`)
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  // 환율: 수정 시엔 저장된 환율, 추가 시엔 실시간 조회 (실패 시 여행 기본 환율)
  const [rate, setRate] = useState<number>(initial?.exchangeRate ?? trip.exchangeRate)
  const [rateNote, setRateNote] = useState(initial?.exchangeRate ? '저장 당시 환율' : '환율 조회 중…')
  const [editRate, setEditRate] = useState(false)
  const refreshRate = async () => {
    setRateNote('환율 조회 중…')
    const r = await getLiveRate(trip.localCurrency, trip.baseCurrency)
    if (r) { setRate(r.rate); setRateNote(`${r.source === 'live' ? '실시간' : '1시간 내 조회'} 환율 · ${dayjs(r.fetchedAt).format('HH:mm')} 기준`) }
    else setRateNote('실시간 조회 실패 → 여행 기본 환율 사용')
  }
  useEffect(() => { if (!initial?.exchangeRate) refreshRate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const num = Number(amount.replace(/,/g, ''))
  const valid = Number.isFinite(num) && num > 0
  const isLocal = currency === trip.localCurrency

  const converted = useMemo(() => {
    if (!valid) return null
    return isLocal ? toBase(num, rate, trip.baseCurrency) : toLocal(num, rate, trip.localCurrency)
  }, [num, valid, isLocal, rate, trip])

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    const amountLocal = isLocal ? num : (converted as number)
    const amountBase = isLocal ? (converted as number) : num
    localStorage.setItem(LAST_PAY_KEY, payment)
    const ok = await onSubmit({
      tripId: trip.id, amountLocal, amountBase, currency, category, paymentMethod: payment,
      exchangeRate: trip.localCurrency === trip.baseCurrency ? 1 : rate,
      memo: memo.trim(), place: place.trim(), spentAt: dayjs(spentAt).format('YYYY-MM-DDTHH:mm:ss'),
    })
    setSaving(false)
    if (ok) onClose()
  }

  const sym = CURRENCY_SYMBOL[currency] ?? currency

  return (
    <Sheet open={open} onClose={onClose} title={initial ? '지출 수정' : '지출 추가'}
      footer={
        <div className="flex gap-2">
          {initial && onDelete && (
            confirmDel
              ? <Button variant="danger" onClick={async () => { await onDelete(); onClose() }}>정말 삭제</Button>
              : <Button variant="ghost" onClick={() => setConfirmDel(true)}>삭제</Button>
          )}
          <Button className="flex-1 py-3" onClick={submit} disabled={!valid || saving}>
            {initial ? '저장' : '추가'}{valid && converted != null && <span className="font-normal opacity-80"> · {isLocal ? fmtMoney(converted, trip.baseCurrency) : fmtMoney(converted, trip.localCurrency)}</span>}
          </Button>
        </div>
      }>
      {/* 금액 */}
      <div className="rounded-2xl bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-lg bg-white p-0.5 shadow-sm">
            {[trip.localCurrency, trip.baseCurrency].filter((c, i, a) => a.indexOf(c) === i).map((c) => (
              <button key={c} onClick={() => setCurrency(c)}
                className={`rounded-md px-3 py-1 text-xs font-bold ${currency === c ? 'bg-brand-500 text-white' : 'text-slate-500'}`}>{c}</button>
            ))}
          </div>
          {trip.localCurrency !== trip.baseCurrency && (
            editRate
              ? <span className="flex items-center gap-1 text-xs text-slate-500">1 {trip.localCurrency} =
                  <input autoFocus type="number" inputMode="decimal" step="0.01" value={rate}
                    onChange={(e) => setRate(Number(e.target.value) || 0)} onBlur={() => { setEditRate(false); setRateNote('직접 입력한 환율') }}
                    className="tnum w-20 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-right text-xs outline-none focus:border-brand-400" />원</span>
              : <button onClick={() => setEditRate(true)} className="text-xs text-slate-500 underline decoration-dotted underline-offset-2">1 {trip.localCurrency} = {rate}원 ✎</button>
          )}
        </div>
        {trip.localCurrency !== trip.baseCurrency && (
          <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-400">
            <span>{rateNote}</span>
            <button onClick={refreshRate} className="rounded-md bg-white px-1.5 py-0.5 font-semibold text-brand-600 shadow-sm">새로고침</button>
          </div>
        )}
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-2xl font-bold text-slate-400">{sym}</span>
          <input autoFocus={autoFocusOnDesktop} type="text" inputMode="decimal" value={amount} placeholder="0"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            className="tnum w-full bg-transparent text-4xl font-extrabold tracking-tight outline-none placeholder:text-slate-300" />
        </div>
        <p className="tnum mt-1 h-5 text-sm text-slate-500">
          {valid && converted != null ? `≈ ${isLocal ? fmtMoney(converted, trip.baseCurrency) : fmtMoney(converted, trip.localCurrency)}` : ''}
        </p>
      </div>

      {/* 카테고리 */}
      <div className="mt-4">
        <span className="mb-2 block text-xs font-semibold text-slate-500">카테고리</span>
        <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
          {CATEGORIES.map((c) => {
            const m = CATEGORY_META[c]; const on = c === category
            return (
              <button key={c} onClick={() => setCategory(c)}
                className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition ${on ? 'ring-2 ring-brand-500' : 'ring-1 ring-slate-200'}`}
                style={{ background: on ? m.bg : 'white', color: on ? m.color : '#64748b' }}>
                <span className="text-xl leading-none">{m.icon}</span>{m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 결제수단 + 일시 */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="결제수단">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {(Object.keys(PAYMENT_META) as PaymentMethod[]).map((p) => (
              <button key={p} onClick={() => setPayment(p)}
                className={`rounded-lg py-2 text-sm font-semibold ${payment === p ? 'bg-white shadow-sm' : 'text-slate-500'}`}>
                {PAYMENT_META[p].icon} {PAYMENT_META[p].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="일시">
          <input type="datetime-local" className={inputCls + ' py-2 px-2 text-[14px] sm:text-base'} value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="메모 (선택)"><input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="카오소이 2그릇" /></Field>
        <Field label="장소 (선택)"><input className={inputCls} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="님만해민" /></Field>
      </div>
    </Sheet>
  )
}
