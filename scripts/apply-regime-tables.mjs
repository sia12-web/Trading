/**
 * Apply regime_cache + market_recommendations (missing from bootstrap).
 */
import pg from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    let val = line.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = val
  }
}

loadEnvLocal()
const parsed = new URL(process.env.DATABASE_URL)
const password = decodeURIComponent(parsed.password)

const sql = `
CREATE TABLE IF NOT EXISTS regime_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  date DATE NOT NULL,
  gap_percent DECIMAL(5, 2) NOT NULL,
  overnight_open DECIMAL(10, 2) NOT NULL,
  overnight_high DECIMAL(10, 2) NOT NULL,
  overnight_low DECIMAL(10, 2) NOT NULL,
  overnight_close DECIMAL(10, 2) NOT NULL,
  regime TEXT NOT NULL CHECK (regime IN ('bullish', 'bearish', 'choppy')),
  regime_confidence SMALLINT NOT NULL CHECK (regime_confidence >= 0 AND regime_confidence <= 100),
  news_headlines JSONB DEFAULT '[]'::jsonb,
  news_sentiment_score SMALLINT DEFAULT 0,
  best_level_break_confidence SMALLINT,
  best_break_level DECIMAL(10, 2),
  recommendation_confidence SMALLINT NOT NULL CHECK (recommendation_confidence >= 0 AND recommendation_confidence <= 100),
  gap_score SMALLINT DEFAULT 0,
  ohlc_score SMALLINT DEFAULT 0,
  news_score SMALLINT DEFAULT 0,
  level_score SMALLINT DEFAULT 0,
  market_disabled BOOLEAN DEFAULT FALSE,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_regime_cache_unique ON regime_cache(instrument, date);
CREATE INDEX IF NOT EXISTS idx_regime_cache_date ON regime_cache(date DESC);

ALTER TABLE regime_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "regime_cache_all_access" ON regime_cache;
CREATE POLICY "regime_cache_all_access" ON regime_cache FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS market_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  recommended_instrument TEXT NOT NULL CHECK (recommended_instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  recommendation_confidence SMALLINT NOT NULL,
  all_recommendations JSONB NOT NULL DEFAULT '{}'::jsonb,
  trader_selected_instrument TEXT CHECK (trader_selected_instrument IS NULL OR trader_selected_instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  selected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_date ON market_recommendations(date DESC);
ALTER TABLE market_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recommendations_all_access" ON market_recommendations;
CREATE POLICY "recommendations_all_access" ON market_recommendations FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
`

const client = new pg.Client({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.ihevmwvqeckaxlffsxdc`,
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

await client.connect()
await client.query(sql)
const r = await client.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('regime_cache','market_recommendations')
   ORDER BY 1`
)
console.log('applied', r.rows.map((x) => x.table_name))
await client.end()
