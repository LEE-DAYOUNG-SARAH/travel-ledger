import { useState } from 'react'
import { Button, Field, Sheet, inputCls, autoFocusOnDesktop } from './ui'
import { COUNTRIES, type Trip, type TripInput } from '../types'
import { api } from '../lib/api'
import { todayKey } from '../lib/format'
import dayjs from 'dayjs'

export function TripForm({ open, onClose, initial, onSubmit }:
  { open: boolean; onClose: () => void; initial?: Trip | null; onSubmit: (t: TripInput) => Promise<unknown> }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [country, setCountry] = useState(initial?.countryCode ?? 'TH')
  const [city, setCity] = useState(initial?.city ?? '')
  const [start, setStart] = useState(initial?.startDate ?? todayKey())
  const [end, setEnd] = useState(initial?.endDate ?? dayjs().add(6, 'day').format('YYYY-MM-DD'))
  const [rate, setRate] = useState(initial ? String(initial.exchangeRate) : '')
  const [budget, setBudget] = useState(initial?.budget != null ? String(initial.budget) : '')
  const [fetching, setFetching] = useState(false)
  const [rateNote, setRateNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const c = COUNTRIES.find((x) => x.code === country) ?? COUNTRIES[0]
  const isKRW = c.currency === 'KRW'

  const fetchRate = async () => {
    setFetching(true); setRateNote('')
    try {
      const r = await api.rate(c.currency, 'KRW')
      setRate(String(Math.round(r.rate * 100) / 100))
      setRateNote(`실시간 환율 적용 (${dayjs(r.updatedAt).format('M/D HH:mm')} 기준)`)
    } catch { setRateNote('환율을 불러오지 못했어요. 직접 입력해주세요.') }
    finally { setFetching(false) }
  }

  const submit = async () => {
    setErr('')
    const rateNum = isKRW ? 1 : Number(rate)
    if (!title.trim()) return setErr('여행 제목을 입력해주세요')
    if (!isKRW && (!rateNum || rateNum <= 0)) return setErr('환율을 입력해주세요 (1 ' + c.currency + ' = ? 원)')
    if (start > end) return setErr('종료일이 시작일보다 빠릅니다')
    setSaving(true)
    await onSubmit({
      title: title.trim(), countryCode: c.code, city: city.trim(),
      startDate: start, endDate: end, localCurrency: c.currency, baseCurrency: 'KRW',
      exchangeRate: rateNum, budget: budget ? Number(budget) : null,
    })
    setSaving(false)
  }

  return (
    <Sheet open={open} onClose={onClose} title={initial ? '여행 수정' : '새 여행'}
      footer={<Button className="w-full py-3" onClick={submit} disabled={saving}>{initial ? '저장' : '여행 만들기'}</Button>}>
      <div className="space-y-4 pt-1">
        <Field label="여행 제목">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예) 치앙마이 한 달 살기" autoFocus={autoFocusOnDesktop} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="국가 / 통화">
            <select className={inputCls} value={country} onChange={(e) => { setCountry(e.target.value); setRate(''); setRateNote('') }}>
              {COUNTRIES.map((x) => <option key={x.code} value={x.code}>{x.flag} {x.name} ({x.currency})</option>)}
            </select>
          </Field>
          <Field label="도시 (선택)">
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="치앙마이" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="시작일"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="종료일"><input type="date" className={inputCls} value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {!isKRW && (
          <Field label={`기본 환율  (1 ${c.currency} = ? 원)`} hint="지출은 저장 시점의 실시간 환율로 계산돼요. 이 값은 실시간 조회가 안 될 때만 쓰입니다.">
            <div className="flex gap-2">
              <input type="number" inputMode="decimal" step="0.01" className={inputCls} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="예) 43.2" />
              <Button variant="soft" onClick={fetchRate} disabled={fetching} className="shrink-0 whitespace-nowrap">{fetching ? '…' : '실시간 환율'}</Button>
            </div>
            {rateNote && <span className="mt-1 block text-[11px] text-brand-600">{rateNote}</span>}
          </Field>
        )}
        <Field label="총 예산 (원, 선택)" hint="입력하면 남은 예산과 하루 평균을 보여줘요.">
          <input type="number" inputMode="numeric" className={inputCls} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="예) 1500000" />
        </Field>
        {err && <p className="text-sm font-medium text-red-500">{err}</p>}
      </div>
    </Sheet>
  )
}
