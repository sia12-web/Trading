/**
 * Persist Empirical Wyckoff 5m Backtest Benchmarks & Range Events to:
 * 1. `lib/trading/wyckoffBenchmarks.data.json` (runtime single source of truth for Leo & UI)
 * 2. `data/wyckoff_monthly_history.json` (versioned monthly snapshot log in git)
 * 3. Supabase (`public.wyckoff_monthly_ingestion_log`, `public.wyckoff_market_benchmarks`,
 *    `public.wyckoff_range_events`) whenever the Supabase project is active.
 *
 * Usage:
 *   node scripts/persist-wyckoff-benchmarks.mjs [--month=2026-10] [--require-db]
 *
 * Designed to run each month after `npm run backtest:wyckoff` so both the local
 * runtime dataset, the monthly historical archive, and the Supabase tables stay 100% synchronized.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const CONTRACT_LABELS = {
  NASDAQ: 'NQ / MNQ',
  DOW: 'YM / MYM',
  CRUDE: 'CL / MCL',
  GOLD: 'GC / MGC',
  NIKKEI: 'NKD / NIY',
}

function loadEnvLocal() {
  const envPath = path.join(root, '.env.local')
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    let val = line.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    const key = line.slice(0, i).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

function poolerConnectionString(databaseUrl, projectRef) {
  const u = new URL(databaseUrl.replace(/^postgresql:/, 'postgres:'))
  const password = decodeURIComponent(u.password)
  const user = `postgres.${projectRef}`
  return `postgresql://${user}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
}

function projectRefFromEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  if (m) return m[1]
  throw new Error('Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL')
}

const round1 = (n) => Math.round(n * 10) / 10

function parseSessions(list) {
  const out = {}
  for (const s of list || []) {
    const m = s.match(/(\w+) \((\d+)\)/)
    if (m) out[m[1]] = Number(m[2])
  }
  return out
}

function buildCharacterProfile(m) {
  const sessions = parseSessions(m.topFormationSessions)
  const total = m.totalRanges || 1
  const asia = round1(((sessions.ASIA ?? 0) / total) * 100)
  const london = round1(((sessions.LONDON ?? 0) / total) * 100)
  const caveats = []
  if (m.totalRanges < 500) {
    caveats.push(`small sample (${m.totalRanges} ranges) - wider uncertainty than NQ/YM/CL`)
  }
  if (m.avgSweepVolumeRatio < 1) {
    caveats.push(
      `sweep bars averaged only ${m.avgSweepVolumeRatio}x range volume - do NOT apply the equity "volume must spike" rule to this market`
    )
  }
  if (m.avgRangeDurationHours > 12) {
    caveats.push(`ranges last ${m.avgRangeDurationHours}h on average (multi-session boxes)`)
  }
  return (
    `${m.totalRanges.toLocaleString()} ranges; ${round1(m.accumulationSpringRatePct)}% of accumulations swept lows, ` +
    `${round1(m.distributionUtadRatePct)}% of distributions swept highs; ` +
    `${round1((((sessions.ASIA ?? 0) + (sessions.LONDON ?? 0)) / total) * 100)}% formed overnight.` +
    (caveats.length ? ` Caveats: ${caveats.join('; ')}.` : '')
  )
}

async function main() {
  loadEnvLocal()

  const monthArg = process.argv.find((a) => a.startsWith('--month='))
  const requireDb = process.argv.includes('--require-db')
  const fullDataPath = path.join(root, 'data', 'wyckoff_range_backtest_1year.json')
  const compactDataPath = path.join(root, 'lib', 'trading', 'wyckoffBenchmarks.data.json')
  const historyDataPath = path.join(root, 'data', 'wyckoff_monthly_history.json')

  let fullData = null
  if (fs.existsSync(fullDataPath)) {
    fullData = JSON.parse(fs.readFileSync(fullDataPath, 'utf8'))
    const compact = {
      metadata: fullData.metadata,
      overall: fullData.overall,
      byMarket: fullData.byMarket,
    }
    fs.writeFileSync(compactDataPath, JSON.stringify(compact, null, 2) + '\n', 'utf8')
    console.log('✅ Synced lib/trading/wyckoffBenchmarks.data.json from data/wyckoff_range_backtest_1year.json')
  }

  const benchmarkData = JSON.parse(fs.readFileSync(compactDataPath, 'utf8'))
  const generatedIso = benchmarkData.metadata?.generatedAt || new Date().toISOString()
  const snapshotMonth = monthArg ? monthArg.split('=')[1] : generatedIso.slice(0, 7)

  const markets = Object.entries(benchmarkData.byMarket)
  const totalRanges = markets.reduce((s, [, m]) => s + m.totalRanges, 0)
  const accRanges = markets.reduce((s, [, m]) => s + m.accumulationCount, 0)
  const distRanges = markets.reduce((s, [, m]) => s + m.distributionCount, 0)

  let totalAsiaCount = 0
  let totalLondonCount = 0
  for (const [, m] of markets) {
    const sess = parseSessions(m.topFormationSessions)
    totalAsiaCount += sess.ASIA ?? 0
    totalLondonCount += sess.LONDON ?? 0
  }
  const overallAsiaPct = round1((totalAsiaCount / (totalRanges || 1)) * 100)
  const overallLondonPct = round1((totalLondonCount / (totalRanges || 1)) * 100)
  const overallOvernightPct = round1(((totalAsiaCount + totalLondonCount) / (totalRanges || 1)) * 100)
  const ov = benchmarkData.overall

  // 1. Update local monthly snapshot history (data/wyckoff_monthly_history.json)
  let historyStore = { snapshots: {} }
  if (fs.existsSync(historyDataPath)) {
    try {
      historyStore = JSON.parse(fs.readFileSync(historyDataPath, 'utf8'))
    } catch {
      historyStore = { snapshots: {} }
    }
  }
  historyStore.snapshots[snapshotMonth] = {
    snapshotMonth,
    ingestedAt: new Date().toISOString(),
    samplePeriod: benchmarkData.metadata?.samplePeriod || 'Last 365 Days',
    timeframe: '5m',
    overall: {
      totalRangesAnalyzed: totalRanges,
      accumulationRanges: accRanges,
      distributionRanges: distRanges,
      springRatePct: round1(ov.overallSpringRatePct),
      lpsRatePct: round1(100 - ov.overallSpringRatePct),
      utadRatePct: round1(ov.overallUtadRatePct),
      lpsyRatePct: round1(100 - ov.overallUtadRatePct),
      sweepDepthAvgAtr: ov.sweepDepthAvgAtr,
      avgBreakoutAtrExpansion: ov.avgAtrExpansionOnBreakout,
      asiaFormationPct: overallAsiaPct,
      londonFormationPct: overallLondonPct,
      overnightFormationPct: overallOvernightPct,
    },
    byMarket: benchmarkData.byMarket,
  }
  fs.mkdirSync(path.dirname(historyDataPath), { recursive: true })
  fs.writeFileSync(historyDataPath, JSON.stringify(historyStore, null, 2) + '\n', 'utf8')
  console.log(
    `✅ Updated monthly historical archive data/wyckoff_monthly_history.json for ${snapshotMonth} (${Object.keys(historyStore.snapshots).length} monthly snapshot(s) stored)`
  )

  // 2. Persist to Supabase if reachable
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.warn('⚠️ DATABASE_URL missing in .env.local — skipping live Supabase upsert.')
    return
  }

  const ref = projectRefFromEnv()
  const cs = poolerConnectionString(databaseUrl, ref)

  const client = new pg.Client({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  })

  try {
    await client.connect()
  } catch (connErr) {
    const msg = connErr?.message || String(connErr)
    if (!requireDb && /not found|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
      console.warn(
        `⚠️ Supabase instance (${ref}) is currently unreachable or paused (${msg}).\n` +
          `   Local runtime benchmarks (lib/trading/wyckoffBenchmarks.data.json) and monthly history (data/wyckoff_monthly_history.json) are fully up to date.\n` +
          `   Once the Supabase project is unpaused, run: npm run db:migrate && npm run db:persist-wyckoff`
      )
      return
    }
    throw connErr
  }

  console.log(`Connected to Supabase (${ref}) for snapshot_month=${snapshotMonth}`)

  try {
    await client.query('BEGIN')

    // Ensure migration tables exist
    const migSqlPath = path.join(
      root,
      'supabase',
      'migrations',
      '20261015_wyckoff_benchmarks_and_monthly_history.sql'
    )
    if (fs.existsSync(migSqlPath)) {
      await client.query(fs.readFileSync(migSqlPath, 'utf8'))
    }

    await client.query(
      `
      INSERT INTO public.wyckoff_monthly_ingestion_log (
        snapshot_month,
        sample_period,
        timeframe,
        total_ranges_analyzed,
        accumulation_ranges,
        distribution_ranges,
        overall_spring_rate_pct,
        overall_lps_rate_pct,
        overall_utad_rate_pct,
        overall_lpsy_rate_pct,
        sweep_depth_avg_atr,
        avg_breakout_atr_expansion,
        asia_formation_pct,
        london_formation_pct,
        overnight_formation_pct,
        summary_payload,
        ingested_at
      ) VALUES (
        $1, $2, '5m', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
      )
      ON CONFLICT (snapshot_month) DO UPDATE SET
        sample_period = EXCLUDED.sample_period,
        total_ranges_analyzed = EXCLUDED.total_ranges_analyzed,
        accumulation_ranges = EXCLUDED.accumulation_ranges,
        distribution_ranges = EXCLUDED.distribution_ranges,
        overall_spring_rate_pct = EXCLUDED.overall_spring_rate_pct,
        overall_lps_rate_pct = EXCLUDED.overall_lps_rate_pct,
        overall_utad_rate_pct = EXCLUDED.overall_utad_rate_pct,
        overall_lpsy_rate_pct = EXCLUDED.overall_lpsy_rate_pct,
        sweep_depth_avg_atr = EXCLUDED.sweep_depth_avg_atr,
        avg_breakout_atr_expansion = EXCLUDED.avg_breakout_atr_expansion,
        asia_formation_pct = EXCLUDED.asia_formation_pct,
        london_formation_pct = EXCLUDED.london_formation_pct,
        overnight_formation_pct = EXCLUDED.overnight_formation_pct,
        summary_payload = EXCLUDED.summary_payload,
        ingested_at = NOW()
      `,
      [
        snapshotMonth,
        benchmarkData.metadata?.samplePeriod || 'Last 365 Days',
        totalRanges,
        accRanges,
        distRanges,
        round1(ov.overallSpringRatePct),
        round1(100 - ov.overallSpringRatePct),
        round1(ov.overallUtadRatePct),
        round1(100 - ov.overallUtadRatePct),
        ov.sweepDepthAvgAtr,
        ov.avgAtrExpansionOnBreakout,
        overallAsiaPct,
        overallLondonPct,
        overallOvernightPct,
        JSON.stringify({ metadata: benchmarkData.metadata, overall: benchmarkData.overall }),
      ]
    )
    console.log(`✅ Upserted wyckoff_monthly_ingestion_log for ${snapshotMonth} (${totalRanges} ranges)`)

    for (const [marketKey, m] of markets) {
      const sess = parseSessions(m.topFormationSessions)
      const tot = m.totalRanges || 1
      const asiaPct = round1(((sess.ASIA ?? 0) / tot) * 100)
      const londonPct = round1(((sess.LONDON ?? 0) / tot) * 100)
      const overnightPct = round1((((sess.ASIA ?? 0) + (sess.LONDON ?? 0)) / tot) * 100)
      const profile = buildCharacterProfile(m)

      await client.query(
        `
        INSERT INTO public.wyckoff_market_benchmarks (
          snapshot_month,
          market,
          contract_label,
          timeframe,
          total_ranges,
          accumulation_count,
          distribution_count,
          spring_rate_pct,
          lps_rate_pct,
          utad_rate_pct,
          lpsy_rate_pct,
          sweep_volume_multiplier,
          avg_range_duration_hours,
          atr_expansion_ratio,
          asia_formation_pct,
          london_formation_pct,
          overnight_formation_pct,
          top_ignition_hours_et,
          top_formation_sessions,
          character_profile,
          payload,
          updated_at
        ) VALUES (
          $1, $2, $3, '5m', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW()
        )
        ON CONFLICT (snapshot_month, market, timeframe) DO UPDATE SET
          contract_label = EXCLUDED.contract_label,
          total_ranges = EXCLUDED.total_ranges,
          accumulation_count = EXCLUDED.accumulation_count,
          distribution_count = EXCLUDED.distribution_count,
          spring_rate_pct = EXCLUDED.spring_rate_pct,
          lps_rate_pct = EXCLUDED.lps_rate_pct,
          utad_rate_pct = EXCLUDED.utad_rate_pct,
          lpsy_rate_pct = EXCLUDED.lpsy_rate_pct,
          sweep_volume_multiplier = EXCLUDED.sweep_volume_multiplier,
          avg_range_duration_hours = EXCLUDED.avg_range_duration_hours,
          atr_expansion_ratio = EXCLUDED.atr_expansion_ratio,
          asia_formation_pct = EXCLUDED.asia_formation_pct,
          london_formation_pct = EXCLUDED.london_formation_pct,
          overnight_formation_pct = EXCLUDED.overnight_formation_pct,
          top_ignition_hours_et = EXCLUDED.top_ignition_hours_et,
          top_formation_sessions = EXCLUDED.top_formation_sessions,
          character_profile = EXCLUDED.character_profile,
          payload = EXCLUDED.payload,
          updated_at = NOW()
        `,
        [
          snapshotMonth,
          marketKey,
          CONTRACT_LABELS[marketKey] || marketKey,
          m.totalRanges,
          m.accumulationCount,
          m.distributionCount,
          round1(m.accumulationSpringRatePct),
          round1(100 - m.accumulationSpringRatePct),
          round1(m.distributionUtadRatePct),
          round1(100 - m.distributionUtadRatePct),
          m.avgSweepVolumeRatio,
          m.avgRangeDurationHours,
          m.avgAtrExpansionRatio,
          asiaPct,
          londonPct,
          overnightPct,
          m.topBreakoutHoursEt || [],
          m.topFormationSessions || [],
          profile,
          JSON.stringify(m),
        ]
      )
      console.log(`   ✔ Upserted market benchmark: ${marketKey} (${m.totalRanges} ranges)`)
    }

    let eventCount = 0
    if (fullData?.topExamplesByMarket) {
      for (const [marketKey, events] of Object.entries(fullData.topExamplesByMarket)) {
        for (const ev of events) {
          const rangeKey = `${marketKey}_5m_${ev.startTime}_${ev.endTime}`
          await client.query(
            `
            INSERT INTO public.wyckoff_range_events (
              range_key,
              snapshot_month,
              market,
              timeframe,
              classification,
              start_time,
              end_time,
              breakout_time,
              duration_bars,
              duration_hours,
              range_low,
              range_high,
              range_width,
              range_atr,
              had_spring_or_utad,
              sweep_depth_atr,
              sweep_volume_ratio,
              cvd_divergence_confirmed,
              net_range_cvd,
              breakout_volume_ratio,
              atr_expansion_ratio,
              post_breakout_mfe_atr,
              formation_session,
              breakout_session,
              breakout_hour_et
            ) VALUES (
              $1, $2, $3, '5m', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
            )
            ON CONFLICT (range_key) DO UPDATE SET
              snapshot_month = EXCLUDED.snapshot_month,
              classification = EXCLUDED.classification,
              post_breakout_mfe_atr = EXCLUDED.post_breakout_mfe_atr
            `,
            [
              rangeKey,
              snapshotMonth,
              marketKey,
              ev.classification,
              ev.startTime,
              ev.endTime,
              ev.breakoutTime,
              ev.durationBars,
              ev.durationHours,
              ev.rangeLow,
              ev.rangeHigh,
              ev.rangeWidth,
              ev.rangeAtr,
              Boolean(ev.hadSpringOrUtad),
              ev.sweepDepthAtr ?? 0,
              ev.sweepVolumeRatio ?? 0,
              Boolean(ev.cvdDivergenceConfirmed),
              ev.netRangeCvd ?? 0,
              ev.breakoutVolumeRatio ?? 0,
              ev.atrExpansionRatio ?? 0,
              ev.postBreakoutMfeAtr ?? 0,
              ev.formationSession,
              ev.breakoutSession,
              ev.breakoutHourEt,
            ]
          )
          eventCount++
        }
      }
      console.log(`✅ Upserted ${eventCount} notable Wyckoff range events into public.wyckoff_range_events`)
    }

    await client.query('COMMIT')
    console.log('\n🎉 All Wyckoff monthly benchmark & range event records committed to Supabase!')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Fatal error persisting Wyckoff benchmarks:', err)
  process.exit(1)
})
