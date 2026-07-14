-- Create trades_journal table to store all trading activity
CREATE TABLE IF NOT EXISTS trades_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Trade identification
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  trade_date DATE NOT NULL,
  entry_window SMALLINT NOT NULL CHECK (entry_window IN (1, 2, 3)),

  -- Entry details
  entry_timestamp TIMESTAMPTZ NOT NULL,
  entry_price DECIMAL(10, 2) NOT NULL CHECK (entry_price > 0),
  entry_direction TEXT NOT NULL CHECK (entry_direction IN ('LONG', 'SHORT')),

  -- Stop loss details
  stop_loss_price DECIMAL(10, 2) NOT NULL CHECK (stop_loss_price > 0),
  stop_loss_hit_at TIMESTAMPTZ,
  stop_loss_hit_count SMALLINT DEFAULT 0,

  -- Position sizing
  position_size DECIMAL(12, 2) NOT NULL CHECK (position_size > 0),
  risk_amount DECIMAL(10, 2) NOT NULL,
  account_size DECIMAL(12, 2) NOT NULL,

  -- Exit details
  exit_timestamp TIMESTAMPTZ,
  exit_price DECIMAL(10, 2),
  exit_reason TEXT CHECK (exit_reason IN ('stop_hit', 'manual', 'lunch_close', 'ai_signal')),

  -- P&L calculation
  profit_loss DECIMAL(10, 2),
  profit_loss_percent DECIMAL(5, 2),

  -- Regime and confidence data
  regime TEXT CHECK (regime IN ('bullish', 'bearish', 'choppy')),
  regime_confidence SMALLINT,
  best_level_break_confidence SMALLINT,
  best_break_level DECIMAL(10, 2),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trades_instrument_date ON trades_journal(instrument, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades_journal(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades_journal(exit_timestamp) WHERE exit_timestamp IS NULL;
CREATE INDEX IF NOT EXISTS idx_trades_entry_window ON trades_journal(trade_date, instrument, entry_window);

-- Unique constraint: one position per instrument per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_unique_daily ON trades_journal(instrument, trade_date) WHERE exit_timestamp IS NULL;

ALTER TABLE trades_journal ENABLE ROW LEVEL SECURITY;

-- RLS: All readable (single-user app)
DROP POLICY IF EXISTS "trades_all_readable" ON trades_journal;
CREATE POLICY "trades_all_readable"
  ON trades_journal FOR SELECT
  USING (true);

-- System can insert trades
DROP POLICY IF EXISTS "trades_system_insert" ON trades_journal;
CREATE POLICY "trades_system_insert"
  ON trades_journal FOR INSERT
  WITH CHECK (true);

-- System can update trades (for exits, stop loss hits)
DROP POLICY IF EXISTS "trades_system_update" ON trades_journal;
CREATE POLICY "trades_system_update"
  ON trades_journal FOR UPDATE
  USING (true);

-- Create entry_windows reference table
CREATE TABLE IF NOT EXISTS entry_windows (
  id SMALLINT PRIMARY KEY,
  window_number SMALLINT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_minutes SMALLINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pre-populate with fixed windows
INSERT INTO entry_windows (id, window_number, start_time, end_time, duration_minutes) VALUES
  (1, 1, '09:30:00'::time, '09:45:00'::time, 15),
  (2, 2, '09:45:00'::time, '10:00:00'::time, 15),
  (3, 3, '10:00:00'::time, '10:15:00'::time, 15)
ON CONFLICT DO NOTHING;

ALTER TABLE entry_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "windows_all_readable" ON entry_windows;
CREATE POLICY "windows_all_readable"
  ON entry_windows FOR SELECT
  USING (true);
