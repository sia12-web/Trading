/**
 * Draggable chart price alert — Telegram when live price touches/crosses.
 *
 * Place-at-spot must not fire: alerts start `pendingAway` until price leaves
 * the level, then arm for a later re-touch / cross.
 */

export const PRICE_ALERT_TOUCH_TOLERANCE = 1

/**
 * Points beyond the touch band that count as "left the alert".
 * Place-at-spot stays pending until live clears this gap, then arms.
 */
export const PRICE_ALERT_AWAY_POINTS = 2

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

/** True when live has cleared the touch band by {@link PRICE_ALERT_AWAY_POINTS}. */
export function hasPriceLeftAlert(args: {
  livePrice: number | null | undefined
  alertPrice: number
  touchTolerance?: number
  awayPoints?: number
}): boolean {
  const live = Number(args.livePrice)
  const alert = Number(args.alertPrice)
  if (!Number.isFinite(live) || live <= 0 || !Number.isFinite(alert) || alert <= 0) {
    return false
  }
  const touch = Math.max(0, args.touchTolerance ?? PRICE_ALERT_TOUCH_TOLERANCE)
  const away = Math.max(0, args.awayPoints ?? PRICE_ALERT_AWAY_POINTS)
  return Math.abs(live - alert) > touch + away
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
  /** Still waiting for touch (false = already fired) */
  armed: boolean
  /**
   * Just placed / dragged onto spot — wait until price leaves before any fire.
   * Once live clears the away gap, clear this and keep `armed: true`.
   */
  pendingAway?: boolean
}

export function loadStoredPriceAlert(instrument: string): StoredPriceAlert | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(instrument))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredPriceAlert
    if (!parsed || !Number.isFinite(parsed.price) || parsed.price <= 0) return null
    return {
      price: parsed.price,
      armed: parsed.armed !== false,
      pendingAway: parsed.pendingAway === true,
    }
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
