import { NextResponse } from 'next/server'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { getOandaCandles } from '@/lib/oanda/candles'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const instruments: Array<{ key: string; inst: Instrument; label: string }> = [
      { key: 'GOLD', inst: 'GOLD', label: 'Gold Cash (CMC/OANDA XAU/USD)' },
      { key: 'DOW', inst: 'DOW', label: 'US 30 Cash (CMC/OANDA US30)' },
      { key: 'NASDAQ', inst: 'NASDAQ', label: 'US NDAQ 100 Cash (CMC/OANDA NAS100)' },
      { key: 'OIL', inst: 'CRUDE', label: 'Crude Oil West Texas Cash (CMC/OANDA WTICO)' },
    ]

    const prices: Record<string, { price: number; bid: number; ask: number; label: string }> = {}

    await Promise.all(
      instruments.map(async ({ key, inst, label }) => {
        try {
          const q = await getOandaPrice(inst)
          if (q) {
            prices[key] = {
              price: q.price,
              bid: q.bid,
              ask: q.ask,
              label,
            }
          } else {
            // Fallback to recent candle close if streaming pricing is quiet
            const pack = await getOandaCandles(inst, '5', 1)
            if (pack?.candles?.length) {
              const last = pack.candles[pack.candles.length - 1]
              if (last) {
                prices[key] = {
                  price: last.close,
                  bid: last.close,
                  ask: last.close,
                  label,
                }
              }
            }
          }
        } catch {
          // ignore individual fetch errors
        }
      })
    )

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
      source: 'oanda_cmc_cash',
      prices,
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch CMC cash prices' },
      { status: 500 }
    )
  }
}
