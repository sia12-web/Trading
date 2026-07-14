-- Slice 4: Entry Discipline System
-- Creates trades_journal for position tracking and entry_discipline_cache for real-time state

CREATE TABLE trades_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  trade_date DATE NOT NULL,

  -- Entry details
  entry_window INTEGER NOT NULL CHECK (entry_window IN (1, 2, 3)),
  entry_time TIMESTAMPTZ NOT NULL,
  entry_price DECIMAL(10, 2) NOT NULL CHECK (entry_price > 0),
  entry_direction TEXT NOT NULL CHECK (entry_direction IN ('LONG', 'SHORT')),

  -- Position sizing
  account_size DECIMAL(12, 2) NOT NULL CHECK (account_size > 0),
  position_size DECIMAL(10, 4) NOT NULL CHECK (position_size > 0),
  risk_amount DECIMAL(10, 2) NOT NULL CHECK (risk_amount > 0),
  risk_percent DECIMAL(5, 2) NOT NULL DEFAULT 5.0,

  -- Stop loss
  stop_loss_price DECIMAL(10, 2) NOT NULL CHECK (stop_loss_price > 0),
  stop_loss_distance DECIMAL(10, 2) NOT NULL,
  stop_loss_percent DECIMAL(5, 2) NOT NULL,
  stop_loss_hit_count INTEGER NOT NULL DEFAULT 0,
  stop_loss_hit_at TIMESTAMPTZ,

  -- Regime info
  regime TEXT CHECK (regime IN ('bullish', 'bearish', 'choppy')),
  regime_confidence DECIMAL(5, 2),

  -- Exit details
  exit_time TIMESTAMPTZ,
  exit_price DECIMAL(10, 2),
  exit_reason TEXT CHECK (exit_reason IN ('stop_hit', 'profit_target', 'manual_close', 'lunch_close')),

  -- P&L
  profit_loss DECIMAL(12, 2),
  profit_loss_percent DECIMAL(7, 2),

  -- Metadata
  notes TEXT,
  is_journal_entry BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trades_journal_user_id ON trades_journal(user_id);
CREATE INDEX idx_trades_journal_user_date ON trades_journal(user_id, trade_date);
CREATE INDEX idx_trades_journal_user_instrument_date ON trades_journal(user_id, instrument, trade_date);
CREATE INDEX idx_trades_journal_entry_window ON trades_journal(user_id, entry_window, trade_date);

ALTER TABLE trades_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own trades"
  ON trades_journal FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own trades"
  ON trades_journal FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own trades"
  ON trades_journal FOR UPDATE
  USING (user_id = auth.uid());

-- Entry Discipline Cache Table
CREATE TABLE entry_discipline_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  trade_date DATE NOT NULL,

  -- Current window state
  current_window INTEGER,
  highest_price_in_window DECIMAL(10, 2),
  lowest_price_in_window DECIMAL(10, 2),
  highest_time TIMESTAMPTZ,
  lowest_time TIMESTAMPTZ,

  -- Entry state
  entry_detected BOOLEAN DEFAULT FALSE,
  entry_direction TEXT CHECK (entry_direction IN ('LONG', 'SHORT')),
  pending_entry_price DECIMAL(10, 2),
  pending_entry_time TIMESTAMPTZ,

  -- Today's regime
  current_regime TEXT CHECK (current_regime IN ('bullish', 'bearish', 'choppy')),
  regime_confidence DECIMAL(5, 2),

  -- Market state
  market_disabled BOOLEAN DEFAULT FALSE,
  last_price DECIMAL(10, 2),
  last_price_update TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_entry_cache_user_instrument_date ON entry_discipline_cache(user_id, instrument, trade_date);

ALTER TABLE entry_discipline_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own cache"
  ON entry_discipline_cache FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own cache"
  ON entry_discipline_cache FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own cache"
  ON entry_discipline_cache FOR UPDATE
  USING (user_id = auth.uid());
