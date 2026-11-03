import { useState } from 'react'
import { useStore } from '../store/useStore'
import { Button, inputCls } from '../components/ui'

export function LoginPage() {
  const login = useStore((s) => s.login)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!pin) return
    setBusy(true); await login(pin); setBusy(false)
  }
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-xs text-center">
        <div className="text-5xl">🧳</div>
        <h1 className="mt-3 text-2xl font-extrabold">여행 가계부</h1>
        <p className="mt-1 text-sm text-slate-500">PIN을 입력해주세요</p>
        <input autoFocus type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
          className={inputCls + ' tnum mt-6 text-center text-xl tracking-[.4em]'} placeholder="••••" />
        <Button type="submit" className="mt-3 w-full py-3" disabled={!pin || busy}>들어가기</Button>
      </form>
    </div>
  )
}
