/**
 * Railway has no vercel.json crons. Poll flatten so a closed browser
 * cannot leave a Tradeify book through 16:59 ET.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveDeskUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'

const TICK_MS = 30_000

export function startTradeifyFlattenWatch(): void {
  const g = globalThis as typeof globalThis & { __tradeifyFlattenWatch?: boolean }
  if (g.__tradeifyFlattenWatch) return
  g.__tradeifyFlattenWatch = true

  const tick = async () => {
    try {
      const { tradeifyMustFlatten } = await import('@/lib/trading/tradeifyGrowth50k')
      if (!tradeifyMustFlatten()) return

      const user = await resolveDeskUser()
      if (!user) return

      const supabase = createAdminClient()
      if (!supabase) return

      const { resolveDeskRiskProfileForUser } = await import(
        '@/lib/trading/tradeifyProfileStore'
      )
      const { isTradeifyGrowth50k } = await import('@/lib/trading/tradeifyProfile')
      const profile = await resolveDeskRiskProfileForUser({
        supabase,
        userId: user.id,
      })
      if (!isTradeifyGrowth50k(profile)) return

      const { cleanupDeskSession } = await import('@/lib/trading/sessionCleanup')
      const result = await cleanupDeskSession(supabase, user.id, {
        forceExpireWorking: true,
        forceCashClose: true,
        tradeifyMustFlatten: true,
      })
      if (result.expiredWorking.length || result.cashClosed.length) {
        logger.info('tradeify.flatten_watch.cleaned', {
          expired: result.expiredWorking.length,
          cashClosed: result.cashClosed.length,
        })
      }
    } catch (err) {
      logger.warn('tradeify.flatten_watch.failed', { err })
    }
  }

  setInterval(() => {
    void tick()
  }, TICK_MS)
  void tick()
  logger.info('tradeify.flatten_watch.started', { tickMs: TICK_MS })
}
