import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import type { LeoLongTermMemory } from '@/lib/trading/leoLongTermMemory'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// In-memory cache for server fallback if DB is not attached
let inMemoryMemories: LeoLongTermMemory[] = [
  {
    id: 'default-macro-nq-memory',
    instrument: 'NASDAQ',
    timeframe: '1D',
    priceLow: 29000,
    priceHigh: 29150,
    purpose: 'Macro HTF Daily Demand Zone — Watch for buyer defense / support',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    triggerCount: 0,
    alarmSoundEnabled: true,
  },
]

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const instrument = searchParams.get('instrument')?.toUpperCase()

    const filtered = instrument
      ? inMemoryMemories.filter((m) => m.instrument.toUpperCase() === instrument)
      : inMemoryMemories

    return NextResponse.json({
      success: true,
      memories: filtered,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to load memories' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, any>
    if (!body || !body.instrument || body.priceLow == null || body.priceHigh == null) {
      return NextResponse.json(
        { error: 'Missing required memory fields (instrument, priceLow, priceHigh)' },
        { status: 400 }
      )
    }

    const rawLow = Number(body.priceLow)
    const rawHigh = Number(body.priceHigh)
    if (!Number.isFinite(rawLow) || !Number.isFinite(rawHigh)) {
      return NextResponse.json(
        { error: 'priceLow and priceHigh must be valid finite numbers' },
        { status: 400 }
      )
    }

    const priceLow = Math.min(rawLow, rawHigh)
    const priceHigh = Math.max(rawLow, rawHigh)

    const memory: LeoLongTermMemory = {
      id: body.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      instrument: String(body.instrument).toUpperCase(),
      timeframe: body.timeframe || '1D',
      priceLow,
      priceHigh,
      purpose: body.purpose || 'Keep eyes on this level when price visits to see if support or resistance',
      notes: body.notes || '',
      status: body.status || 'ACTIVE',
      createdAt: body.createdAt || new Date().toISOString(),
      triggerCount: body.triggerCount || 0,
      alarmSoundEnabled: body.alarmSoundEnabled !== false,
      sourceDrawingId: body.sourceDrawingId,
    }

    const index = inMemoryMemories.findIndex((m) => m.id === memory.id)
    if (index >= 0) {
      inMemoryMemories[index] = memory
    } else {
      inMemoryMemories.unshift(memory)
    }

    return NextResponse.json({
      success: true,
      memory,
      memories: inMemoryMemories,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to save memory' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    inMemoryMemories = inMemoryMemories.filter((m) => m.id !== id)

    return NextResponse.json({
      success: true,
      memories: inMemoryMemories,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to delete memory' }, { status: 500 })
  }
}
