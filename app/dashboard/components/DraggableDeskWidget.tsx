'use client'

/**
 * Floating desk widget — drag by the chrome handle; position persists in sessionStorage.
 * Live drag mutates left/top via rAF (no React re-render / sessionStorage per frame).
 * Move/up listeners attach synchronously on pointerdown so release never races React state.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

export type WidgetPos = { x: number; y: number }

type Props = {
  storageKey: string
  defaultPos?: WidgetPos
  widthClassName?: string
  maxHeightClassName?: string
  className?: string
  title: ReactNode
  subtitle?: ReactNode
  onClose?: () => void
  children: ReactNode
  footer?: ReactNode
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function loadPos(key: string, fallback: WidgetPos): WidgetPos {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as WidgetPos
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) return parsed
  } catch {
    /* ignore */
  }
  return fallback
}

export function DraggableDeskWidget({
  storageKey,
  defaultPos = { x: 24, y: 72 },
  widthClassName = 'w-[min(19.5rem,calc(100vw-1.5rem))]',
  maxHeightClassName = 'max-h-[min(48vh,420px)]',
  className = '',
  title,
  subtitle,
  onClose,
  children,
  footer,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<WidgetPos>(() => loadPos(storageKey, defaultPos))
  const [dragging, setDragging] = useState(false)
  const posRef = useRef(pos)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<WidgetPos | null>(null)
  const unbindRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const next = loadPos(storageKey, defaultPos)
    posRef.current = next
    setPos(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-load when key / default coords change
  }, [storageKey, defaultPos.x, defaultPos.y])

  useLayoutEffect(() => {
    posRef.current = pos
    const el = rootRef.current
    if (!el || dragging) return
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`
  }, [pos, dragging])

  useEffect(() => {
    return () => {
      unbindRef.current?.()
      unbindRef.current = null
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const applyLivePos = (next: WidgetPos) => {
    pendingRef.current = next
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const p = pendingRef.current
      const el = rootRef.current
      if (!p || !el) return
      posRef.current = p
      el.style.left = `${p.x}px`
      el.style.top = `${p.y}px`
    })
  }

  const persist = useCallback(
    (next: WidgetPos) => {
      posRef.current = next
      setPos(next)
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* private mode */
      }
    },
    [storageKey]
  )

  const finishDrag = useCallback(() => {
    unbindRef.current?.()
    unbindRef.current = null

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const finalPos = pendingRef.current ?? posRef.current
    pendingRef.current = null
    dragRef.current = null
    persist(finalPos)
    setDragging(false)
  }, [persist])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('button, a, input, select, textarea')) return

    // Already dragging — ignore
    if (dragRef.current) return

    e.preventDefault()
    e.stopPropagation()

    const origin = posRef.current
    const pointerId = e.pointerId
    dragRef.current = {
      pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: origin.x,
      originY: origin.y,
    }
    pendingRef.current = null
    setDragging(true)

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d || d.pointerId !== ev.pointerId) return
      const parent = rootRef.current?.offsetParent as HTMLElement | null
      const pw = parent?.clientWidth ?? window.innerWidth
      const ph = parent?.clientHeight ?? window.innerHeight
      const ww = rootRef.current?.offsetWidth ?? 312
      const wh = rootRef.current?.offsetHeight ?? 220
      applyLivePos({
        x: clamp(d.originX + (ev.clientX - d.startX), 8, Math.max(8, pw - ww - 8)),
        y: clamp(d.originY + (ev.clientY - d.startY), 8, Math.max(8, ph - wh - 8)),
      })
    }

    const onUp = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d || d.pointerId !== ev.pointerId) return
      finishDrag()
    }

    const onAbort = () => {
      if (!dragRef.current) return
      finishDrag()
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onAbort()
    }

    const unbind = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onAbort)
      window.removeEventListener('keydown', onKey)
    }
    unbindRef.current = unbind

    // Sync attach — do not wait for React re-render (that caused stuck drag)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onAbort)
    window.addEventListener('keydown', onKey)
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Morning playbook"
      className={[
        'absolute z-30 flex flex-col overflow-hidden rounded-xl',
        // Solid panel — light chart session colors must not bleed through translucency
        'border border-[#30363d] bg-[#0d1117]',
        'shadow-[0_16px_48px_rgba(0,0,0,0.65),0_0_0_1px_rgba(0,0,0,0.4)]',
        widthClassName,
        maxHeightClassName,
        dragging ? 'cursor-grabbing select-none will-change-[left,top]' : '',
        className,
      ].join(' ')}
      style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
    >
      <div
        onPointerDown={onPointerDown}
        className={[
          'flex shrink-0 items-center gap-1.5 border-b border-[#30363d] px-2 py-1',
          'bg-[#161b22]',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        ].join(' ')}
        title="Drag to move"
      >
        <span
          className="grid h-5 w-3.5 shrink-0 grid-cols-2 place-content-center gap-px text-violet-300/55"
          aria-hidden
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="h-0.5 w-0.5 rounded-full bg-current" />
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-200">
            {title}
          </div>
          {subtitle ? (
            <div className="truncate text-[9px] leading-tight text-gray-500">{subtitle}</div>
          ) : null}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] text-gray-500 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/50"
            aria-label="Close playbook"
          >
            ✕
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#0d1117] scrollbar-dark">
        {children}
      </div>

      {footer ? (
        <div className="shrink-0 border-t border-[#30363d] bg-[#010409] px-3 py-2">
          {footer}
        </div>
      ) : null}
    </div>
  )
}
