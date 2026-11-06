import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { Button, inputCls } from '../components/ui'

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; auto_select?: boolean }) => void
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
      prompt: () => void
    } } }
  }
}

/** Google Identity Services 스크립트 1회 로드 */
function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()
    const id = 'gis-script'
    if (document.getElementById(id)) { document.getElementById(id)!.addEventListener('load', () => resolve()); return }
    const s = document.createElement('script')
    s.id = id; s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true
    s.onload = () => resolve(); s.onerror = () => reject(new Error('gis load failed'))
    document.head.appendChild(s)
  })
}

export function LoginPage() {
  const { authMode, googleClientId, login, loginGoogle } = useStore()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [gisErr, setGisErr] = useState('')
  const btnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (authMode !== 'google' || !googleClientId) return
    let cancelled = false
    loadGis().then(() => {
      if (cancelled || !btnRef.current || !window.google) return
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => { setBusy(true); await loginGoogle(credential); setBusy(false) },
      })
      window.google.accounts.id.renderButton(btnRef.current, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 280, locale: 'ko' })
    }).catch(() => setGisErr('구글 로그인 스크립트를 불러오지 못했어요. 네트워크를 확인해주세요.'))
    return () => { cancelled = true }
  }, [authMode, googleClientId, loginGoogle])

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault(); if (!pin) return
    setBusy(true); await login(pin); setBusy(false)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <div className="text-5xl">🧳</div>
        <h1 className="mt-3 text-2xl font-extrabold">여행 가계부</h1>
        {authMode === 'google' ? (
          <>
            <p className="mt-1 text-sm text-slate-500">구글 계정으로 로그인해주세요</p>
            <div className="mt-6 flex min-h-[44px] justify-center">
              <div ref={btnRef} />
            </div>
            {busy && <p className="mt-3 text-xs text-slate-400">로그인 중…</p>}
            {gisErr && <p className="mt-3 text-xs text-red-500">{gisErr}</p>}
          </>
        ) : (
          <form onSubmit={submitPin}>
            <p className="mt-1 text-sm text-slate-500">PIN을 입력해주세요</p>
            <input autoFocus type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
              className={inputCls + ' tnum mt-6 text-center text-xl tracking-[.4em]'} placeholder="••••" />
            <Button type="submit" className="mt-3 w-full py-3" disabled={!pin || busy}>들어가기</Button>
          </form>
        )}
      </div>
    </div>
  )
}
