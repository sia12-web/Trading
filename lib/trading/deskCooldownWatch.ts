import { logger } from '@/lib/utils/logger'
import { deskPhaseAt, isCloseReprintWindow, isOvernightInventoryWindow } from '@/lib/trading/deskClockPhase'

const TICK_MS = 60_000

export function startDeskCooldownWatch(): void {
  const g = globalThis as typeof globalThis & { __deskCooldownWatch?: boolean }
  if (g.__deskCooldownWatch) return
  g.__deskCooldownWatch = true

  const tick = async () => {
    try {
      const now = new Date()
      if (!isCloseReprintWindow(now) && !isOvernightInventoryWindow(now)) return
      const { tickDeskCooldown } = await import('@/lib/trading/deskReprint')
      const result = await tickDeskCooldown(now)
      if (result.reprinted.length || result.inventory.length) {
        logger.info('desk.cooldown.watch', {
          phase: deskPhaseAt(now),
          reprinted: result.reprinted,
          inventory: result.inventory,
        })
      }
    } catch (err) {
      logger.warn('desk.cooldown.watch.failed', { err })
    }
  }

  setInterval(() => {
    void tick()
  }, TICK_MS)
  void tick()
  logger.info('desk.cooldown.watch.started', { tickMs: TICK_MS })
}
