/**
 * Draggable chart price alert — Telegram when live price touches/crosses.
 */

export const PRICE_ALERT_TOUCH_TOLERANCE = 1

/**
 * True when price has crossed or entered ±tol of alertLevel.
 * Requires a prior print so we don't fire on alert create while already at price.
 */
export function didPriceTouchAlert(args: {
  prevPrice: number | null | undefined
  livePrice: number | null | undefined
  alertPrice: number
  tolerance?: number
}): boolean {
  const live = Number(args.livePrice)
  const alert = Number(args.alertPrice)
  const tol = Math.max(0, args.tolerance ?? PRICE_ALERT_TOUCH_TOLERANCE)
  if (!Number.isFinite(live) || live <= 0 || !Number.isFinite(alert) || alert <= 0) {
    return false
  }
  const prev = args.prevPrice != null ? Number(args.prevPrice) : null
  if (prev == null || !Number.isFinite(prev) || prev <= 0) return false

  if (Math.abs(live - alert) <= tol) return true
  // Strict cross: prev and live on opposite sides of alert (or on the line)
  if ((prev - alert) * (live - alert) <= 0) return true
  return false
}

export function formatPriceTouchAlert(args: {
  instrument: string
  alertPrice: number
  livePrice: number
}): { kind: string; title: string; body: string; telegram: string } {
  const px = args.alertPrice.toLocaleString()
  const live = args.livePrice.toLocaleString()
  const title = `${args.instrument} price alert touched @ ${px}`
  const body = `Live ${live} hit your chart alert at ${px}. Soft signal only — not an order.`
  return {
    kind: 'price_touch_alert',
    title,
    body,
    telegram: `${title}\n${body}`,
  }
}

const storageKey = (instrument: string) => `tp.priceAlert.${instrument}`

export type StoredPriceAlert = {
  price: number
  /** Still waiting for touch */
  armed: boolean
}

export function loadStoredPriceAlert(instrument: string): StoredPriceAlert | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(instrument))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredPriceAlert
    if (!parsed || !Number.isFinite(parsed.price) || parsed.price <= 0) return null
    return { price: parsed.price, armed: parsed.armed !== false }
  } catch {
    return null
  }
}

export function saveStoredPriceAlert(
  instrument: string,
  alert: StoredPriceAlert | null
): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (!alert) {
      localStorage.removeItem(storageKey(instrument))
      return
    }
    localStorage.setItem(storageKey(instrument), JSON.stringify(alert))
  } catch {
    /* private mode */
  }
}
