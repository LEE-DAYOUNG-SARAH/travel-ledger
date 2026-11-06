import { useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useStore } from '../store/useStore'
import { Button, Card } from '../components/ui'
import { api } from '../lib/api'
import { CATEGORY_META, PAYMENT_META, type Expense, type Trip } from '../types'

function download(name: string, content: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function SettingsPage() {
  const { trips, authRequired, user, logout, loadTrips, recalcTrip, toast } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [replace, setReplace] = useState(false)

  const exportJSON = async () => {
    setBusy(true)
    try { download(`travel-ledger-${dayjs().format('YYYYMMDD-HHmm')}.json`, JSON.stringify(await api.exportAll(), null, 2), 'application/json') }
    catch { toast('내보내기 실패', 'err') } finally { setBusy(false) }
  }
  const exportCSV = async () => {
    setBusy(true)
    try {
      const d = (await api.exportAll()) as { trips: Trip[]; expenses: Expense[] }
      const tmap = new Map(d.trips.map((t) => [t.id, t]))
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const rows = [['여행', '일시', '카테고리', '결제수단', '현지금액', '통화', '원화환산', '메모', '장소']]
      for (const e of d.expenses.sort((a, b) => a.spentAt.localeCompare(b.spentAt))) {
        rows.push([tmap.get(e.tripId)?.title ?? '', e.spentAt.replace('T', ' '), CATEGORY_META[e.category].label, PAYMENT_META[e.paymentMethod].label,
          String(e.amountLocal), e.currency, String(e.amountBase), e.memo, e.place])
      }
      download(`travel-ledger-${dayjs().format('YYYYMMDD-HHmm')}.csv`, '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n'), 'text/csv;charset=utf-8')
    } catch { toast('내보내기 실패', 'err') } finally { setBusy(false) }
  }
  const importJSON = async (f: File) => {
    setBusy(true)
    try {
      const payload = JSON.parse(await f.text())
      if (replace && !confirm('기존 데이터를 모두 지우고 백업으로 교체합니다. 계속할까요?')) return
      const r = await api.importAll(payload, replace)
      toast(`여행 ${r.trips}개 · 지출 ${r.expenses}건 가져왔어요`)
      await loadTrips()
    } catch (e) { toast(e instanceof Error ? e.message : '가져오기 실패', 'err') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4 pt-safe-4">
      <header className="mb-5 flex items-center gap-2">
        <a href="#/" aria-label="뒤로" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 6l-6 6 6 6" /></svg>
        </a>
        <h1 className="text-xl font-extrabold">설정 · 백업</h1>
      </header>

      <Card className="p-5">
        <h2 className="font-bold">데이터 백업</h2>
        <p className="mt-1 text-sm text-slate-500">데이터는 서버(SQLite)에 저장되지만, 주기적으로 내려받아 두면 더 안전해요. JSON은 복원용, CSV는 엑셀/시트용입니다.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={exportJSON} disabled={busy}>JSON 내려받기</Button>
          <Button variant="soft" onClick={exportCSV} disabled={busy}>CSV 내려받기</Button>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-bold">JSON 복원</h3>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="h-4 w-4 accent-brand-500" />
            기존 데이터를 지우고 교체 (끄면 병합)
          </label>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} />
          <Button variant="ghost" className="mt-2 ring-1 ring-slate-200" onClick={() => fileRef.current?.click()} disabled={busy}>파일 선택해서 복원</Button>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="font-bold">환율 재계산</h2>
        <p className="mt-1 text-sm text-slate-500">지출은 각각 저장 시점의 환율로 계산돼 있어요. 모든 지출을 여행의 <b>기본 환율</b> 하나로 다시 맞추고 싶을 때만 눌러주세요 (보통 필요 없음).</p>
        <ul className="mt-3 divide-y divide-slate-100">
          {trips.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
              <span><b>{t.title}</b> <span className="text-slate-400">· 1 {t.localCurrency} = {t.exchangeRate}원</span></span>
              <Button variant="soft" className="px-3 py-1.5 text-xs" onClick={() => { if (confirm(`'${t.title}'의 모든 지출을 현재 환율로 다시 계산할까요?`)) recalcTrip(t.id) }}>재계산</Button>
            </li>
          ))}
          {trips.length === 0 && <li className="py-2 text-sm text-slate-400">여행이 없어요</li>}
        </ul>
      </Card>

      {authRequired && (
        <Card className="mt-4 p-5">
          <h2 className="font-bold">계정</h2>
          {user && (
            <div className="mt-3 flex items-center gap-3">
              {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-lg">👤</div>}
              <div className="min-w-0"><p className="truncate font-semibold">{user.name || '사용자'}</p><p className="truncate text-xs text-slate-500">{user.email}</p></div>
            </div>
          )}
          <p className="mt-3 text-sm text-slate-500">여행과 지출은 이 계정에만 보여요. 다른 기기에서도 같은 계정으로 로그인하면 이어서 쓸 수 있어요.</p>
          <Button variant="danger" className="mt-3" onClick={logout}>로그아웃</Button>
        </Card>
      )}
      <p className="mt-6 text-center text-xs text-slate-400">여행 가계부 · v1.0</p>
    </div>
  )
}
