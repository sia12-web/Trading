/**
 * GET /api/trading/questrade/book
 * Read-only Questrade orders, equity curve, Tradeify transfer previews.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { loadQuestradeBook } from '@/lib/trading/questradeBook'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient() ?? (await createClient())
  try {
    const book = await loadQuestradeBook(supabase)
    return NextResponse.json(book)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Questrade read failed'
    return NextResponse.json({ ok: false, error: message })
  }
}
