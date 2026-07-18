'use client'

/**
 * Floating desk widget — drag by the chrome handle; position persists in sessionStorage.
 */

import {
  useCallback,
  useEffect,
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
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  useEffect(() => {
    setPos(loadPos(storageKey, defaultPos))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-load when key / default coords change
  }, [storageKey, defaultPos.x, defaultPos.y])

  const persist = useCallback(
    (next: WidgetPos) => {
      setPos(next)
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* private mode */
      }
    },
    [storageKey]
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('button, a, input, select, textarea')) return

    const el = rootRef.current
    if (!el) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    }
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const parent = rootRef.current?.offsetParent as HTMLElement | null
    const pw = parent?.clientWidth ?? window.innerWidth
    const ph = parent?.clientHeight ?? window.innerHeight
    const ww = rootRef.current?.offsetWidth ?? 312
    const wh = rootRef.current?.offsetHeight ?? 220
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    persist({
      x: clamp(d.originX + dx, 8, Math.max(8, pw - ww - 8)),
      y: clamp(d.originY + dy, 8, Math.max(8, ph - wh - 8)),
    })
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    try {
      rootRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Morning playbook"
      className={[
        'absolute z-40 flex flex-col overflow-hidden rounded-2xl',
        'border border-white/[0.14] bg-[#0b0f18]/94',
        'shadow-[0_24px_64px_rgba(0,0,0,0.65),0_0_0_1px_rgba(139,92,246,0.12)]',
        'backdrop-blur-2xl',
        widthClassName,
        maxHeightClassName,
        dragging ? 'scale-[1.01] cursor-grabbing select-none shadow-[0_28px_72px_rgba(0,0,0,0.7)]' : '',
        'transition-[box-shadow,transform] duration-200 ease-out',
        'motion-reduce:transition-none motion-reduce:transform-none',
        className,
      ].join(' ')}
      style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
    >
      {/* Drag handle — grab anywhere on this bar */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={[
          'flex shrink-0 items-center gap-2.5 border-b border-white/10 px-3 py-2.5',
          'bg-gradient-to-b from-[#1a1530]/95 to-[#121826]/90',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        ].join(' ')}
        title="Drag to move"
      >
        <span
          className="grid h-9 w-7 shrink-0 grid-cols-2 place-content-center gap-0.5 rounded-md bg-white/5 text-violet-300/80"
          aria-hidden
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="h-1 w-1 rounded-full bg-current" />
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-200">
            {title}
          </div>
          <div className="mt-0.5 truncate text-[9px] font-medium uppercase tracking-wider text-violet-300/70">
            {dragging ? 'Moving…' : 'Drag to move'}
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-[10px] leading-snug text-gray-500">{subtitle}</div>
          ) : null}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
            aria-label="Close playbook"
          >
            ✕
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-dark">
        {children}
      </div>

      {footer ? (
        <div className="shrink-0 border-t border-white/10 bg-[#080b12]/90 px-3 py-2.5">
          {footer}
        </div>
      ) : null}
    </div>
  )
}
