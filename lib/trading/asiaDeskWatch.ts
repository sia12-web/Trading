/**
 * Railway has no vercel.json crons. Poll Asia lock / 03:30 cancel / 11:30 flatten
 * so Telegram fires even if Trade Pulse is closed.
 */

import { logger } from '@/lib/utils/logger'
import {
  isAsiaDeskFlattenWindow,
  isAsiaDeskScanWindow,
} from '@/lib/trading/asiaDesk'

const TICK_MS = 30_000

export function startAsiaDeskWatch(): void {
  const g = globalThis as typeof globalThis & { __asiaDeskWatch?: boolean }
  if (g.__asiaDeskWatch) return
  g.__asiaDeskWatch = true

  const tick = async () => {
    try {
      const now = new Date()
      if (!isAsiaDeskScanWindow(now) && !isAsiaDeskFlattenWindow(now)) return
      const { runAsiaDeskScanForDeskUser } = await import('@/lib/trading/asiaDeskScan')
      const result = await runAsiaDeskScanForDeskUser(now)
      if (result?.telegram.some((t) => t.sent)) {
        logger.info('asia_desk.watch.telegram', { telegram: result.telegram })
      }
    } catch (err) {
      logger.warn('asia_desk.watch.failed', { err })
    }
  }

  setInterval(() => {
    void tick()
  }, TICK_MS)
  void tick()
  logger.info('asia_desk.watch.started', { tickMs: TICK_MS })
}
