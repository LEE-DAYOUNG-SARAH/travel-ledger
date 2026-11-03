import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store/useStore'

export function Button({ children, variant = 'primary', className = '', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'soft' }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[.98] disabled:opacity-40 disabled:active:scale-100'
  const v = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/30',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100',
  }[variant]
  return <button className={`${base} ${v} ${className}`} {...rest}>{children}</button>
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,.04),0_4px_16px_-8px_rgba(15,23,42,.08)] ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}
export const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-base outline-none appearance-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 placeholder:text-slate-400'

/** 모바일: 바텀시트 / 데스크톱: 중앙 모달
 *  iOS 키보드 대응: 시트를 window 높이가 아니라 visualViewport(실제 보이는 영역) 기준으로 배치 →
 *  키보드가 올라와도 시트가 밀려 올라가지 않고, 안쪽 영역만 스크롤됨 */
export function Sheet({ open, onClose, title, children, footer }:
  { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  const [vv, setVv] = useState<{ h: number; top: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    const v = window.visualViewport
    const sync = () => v && setVv({ h: v.height, top: v.offsetTop + (window.scrollY || 0) })
    sync(); v?.addEventListener('resize', sync); v?.addEventListener('scroll', sync)
    return () => {
      removeEventListener('keydown', onKey); document.body.style.overflow = ''
      v?.removeEventListener('resize', sync); v?.removeEventListener('scroll', sync)
    }
  }, [open, onClose])
  if (!open) return null
  // 입력창에 포커스되면 키보드 위로 보이게 안쪽 스크롤
  const onFocus = (e: React.FocusEvent) => {
    const el = e.target as HTMLElement
    if (el.matches('input, select, textarea')) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)
  }
  return (
    <div className="fixed inset-x-0 z-50 flex items-end justify-center sm:items-center"
      style={vv ? { top: vv.top, height: vv.h } : { top: 0, height: '100dvh' }}>
      <div className="absolute inset-0 bg-slate-900/40 animate-fade-in" onClick={onClose} />
      <div className="relative flex w-full flex-col rounded-t-3xl bg-white shadow-2xl animate-slide-up sm:max-w-lg sm:rounded-3xl"
        style={{ maxHeight: vv ? Math.round(vv.h * 0.94) : '92dvh' }}>
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
        {title && (
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        )}
        <div onFocusCapture={onFocus} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 ${footer ? '' : 'pb-safe'}`}>{children}</div>
        {footer && <div className="border-t border-slate-100 px-5 py-3 pb-safe">{footer}</div>}
      </div>
    </div>
  )
}

/** 터치 기기(폰)에서는 자동 포커스로 키보드가 바로 튀어나오지 않게 */
export const autoFocusOnDesktop = typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`animate-fade-in rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg ${t.kind === 'err' ? 'bg-red-500' : 'bg-slate-800'}`}>{t.msg}</div>
      ))}
    </div>
  )
}

export function Empty({ icon, title, desc, action }: { icon: string; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center py-14 text-center">
      <div className="text-5xl">{icon}</div>
      <p className="mt-3 font-semibold text-slate-700">{title}</p>
      {desc && <p className="mt-1 text-sm text-slate-400">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options }:
  { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({ ratio, danger }: { ratio: number; danger?: boolean }) {
  const pct = Math.max(0, Math.min(100, ratio * 100))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-all ${danger ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
