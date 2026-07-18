/**
 * Applies the minimum schema required by the dashboard APIs to the
 * project referenced by .env.local (via Supabase session pooler / IPv4).
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[line.slice(0, i).trim()]) {
      process.env[line.slice(0, i).trim()] = val
    }
  }
}

loadEnvLocal()

const parsed = new URL(process.env.DATABASE_URL)
const password = decodeURIComponent(parsed.password)
const ref = 'ihevmwvqeckaxlffsxdc'
const DEV_USER_ID = '00000000-0000-0000-0000-000000000001'

const sql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  email TEXT,
  trading_mode TEXT NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_all_access" ON profiles;
CREATE POLICY "profiles_all_access" ON profiles FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  index_recommendation TEXT CHECK (index_recommendation IN ('DOW', 'NASDAQ')),
  prep_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sessions_all_access" ON sessions;
CREATE POLICY "sessions_all_access" ON sessions FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS trades_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  trade_date DATE NOT NULL,
  entry_window SMALLINT NOT NULL CHECK (entry_window IN (1, 2, 3)),
  entry_timestamp TIMESTAMPTZ NOT NULL,
  entry_price DECIMAL(10, 2) NOT NULL CHECK (entry_price > 0),
  entry_direction TEXT NOT NULL CHECK (entry_direction IN ('LONG', 'SHORT')),
  stop_loss_price DECIMAL(10, 2) NOT NULL CHECK (stop_loss_price > 0),
  stop_loss_distance DECIMAL(10, 2),
  stop_loss_percent DECIMAL(5, 2),
  stop_loss_hit_at TIMESTAMPTZ,
  stop_loss_hit_count SMALLINT NOT NULL DEFAULT 0,
  position_size DECIMAL(12, 4) NOT NULL CHECK (position_size > 0),
  risk_amount DECIMAL(10, 2) NOT NULL,
  account_size DECIMAL(12, 2) NOT NULL,
  exit_timestamp TIMESTAMPTZ,
  exit_price DECIMAL(10, 2),
  exit_reason TEXT CHECK (exit_reason IN ('stop_hit', 'manual', 'manual_close', 'lunch_close', 'ai_signal', 'profit_target')),
  profit_loss DECIMAL(12, 2),
  profit_loss_percent DECIMAL(7, 2),
  regime TEXT CHECK (regime IN ('bullish', 'bearish', 'choppy')),
  regime_confidence DECIMAL(5, 2),
  best_level_break_confidence SMALLINT,
  best_break_level DECIMAL(10, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_journal_user_instrument_date
  ON trades_journal(user_id, instrument, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_trades_journal_open
  ON trades_journal(user_id, instrument, trade_date)
  WHERE exit_timestamp IS NULL;

ALTER TABLE trades_journal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trades_journal_all_access" ON trades_journal;
CREATE POLICY "trades_journal_all_access" ON trades_journal FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS level_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  level DECIMAL(10, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('support', 'resistance', 'vwap')),
  conviction INT NOT NULL CHECK (conviction >= 1 AND conviction <= 10),
  reasoning TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('D', '4H', 'H1')),
  tested_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  last_tested_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_level_history_user_instrument_created
  ON level_history(user_id, instrument, created_at DESC);

ALTER TABLE level_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "level_history_all_access" ON level_history;
CREATE POLICY "level_history_all_access" ON level_history FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS simulation_replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  replay_date DATE NOT NULL,
  playback_speed NUMERIC(4,2) NOT NULL CHECK (playback_speed IN (0.25, 0.5, 1, 2, 4, 16)),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  final_pnl NUMERIC(12, 2),
  final_pnl_percent NUMERIC(8, 2),
  trades_count INTEGER DEFAULT 0 CHECK (trades_count >= 0),
  replay_duration_seconds INTEGER CHECK (replay_duration_seconds >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_simulation_replays_unique_session
  ON simulation_replays(user_id, replay_date, instrument);

ALTER TABLE simulation_replays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "simulation_replays_all_access" ON simulation_replays;
CREATE POLICY "simulation_replays_all_access" ON simulation_replays FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS replay_availability_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  replay_date DATE NOT NULL,
  is_available BOOLEAN NOT NULL,
  last_checked TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_replay_availability_unique
  ON replay_availability_cache(instrument, replay_date);

INSERT INTO profiles (id, email, trading_mode)
VALUES ('${DEV_USER_ID}', 'dev@example.com', 'paper')
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`

const client = new pg.Client({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${ref}`,
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

await client.connect()
try {
  await client.query(sql)
  const r = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('profiles','sessions','trades_journal','level_history','simulation_replays','replay_availability_cache')
     ORDER BY 1`
  )
  console.log('applied_tables', r.rows.map((x) => x.table_name))
} finally {
  await client.end()
}
