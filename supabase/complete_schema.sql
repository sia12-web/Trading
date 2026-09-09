-- Combined Schema for Trading Platform
-- Generated on: 2026-09-08T19:04:47.322Z

-- ==========================================
-- Migration: 20260517_create_identified_levels.sql
-- ==========================================
-- Core table for Level Finder session outputs (was referenced but never created)
CREATE TABLE IF NOT EXISTS identified_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  level DECIMAL(12, 2) NOT NULL CHECK (level > 0),
  type TEXT NOT NULL CHECK (type IN ('support', 'resistance', 'vwap')),
  conviction INT NOT NULL CHECK (conviction >= 1 AND conviction <= 10),
  reasoning TEXT NOT NULL DEFAULT 'Level identified by Agent 1',
  timeframe TEXT NOT NULL DEFAULT '4H' CHECK (timeframe IN ('D', '4H', 'H1')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identified_levels_session
  ON identified_levels(session_id);

CREATE INDEX IF NOT EXISTS idx_identified_levels_created
  ON identified_levels(created_at DESC);

ALTER TABLE identified_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "identified_levels_read" ON identified_levels;
CREATE POLICY "identified_levels_read"
  ON identified_levels FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "identified_levels_insert" ON identified_levels;
CREATE POLICY "identified_levels_insert"
  ON identified_levels FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "identified_levels_update" ON identified_levels;
CREATE POLICY "identified_levels_update"
  ON identified_levels FOR UPDATE
  USING (true);


-- ==========================================
-- Migration: 20260518_add_paper_trading.sql
-- ==========================================
-- Slice 15: Add paper trading mode toggle support
-- Allows users to switch between paper (simulation) and live (real) trading modes

-- Add trading_mode to profiles table (user's default preference)
ALTER TABLE profiles
ADD COLUMN trading_mode TEXT NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live'));

CREATE INDEX idx_profiles_trading_mode ON profiles(trading_mode);

-- Add is_paper_trading to positions table (per-position override)
ALTER TABLE positions
ADD COLUMN is_paper_trading BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX idx_positions_is_paper_trading ON positions(user_id, is_paper_trading);

-- No RLS policy changes needed - existing policies remain in effect
-- Paper trading flag is used only in application logic, not in data access control


-- ==========================================
-- Migration: 20260713_add_reasoning_timeframe_to_identified_levels.sql
-- ==========================================
-- Migration: Add reasoning and timeframe columns to identified_levels
-- Safe if table/columns already exist (bootstrap may have created them)

DO $$
BEGIN
  IF to_regclass('public.identified_levels') IS NULL THEN
    RAISE NOTICE 'identified_levels missing — skip alter';
    RETURN;
  END IF;

  ALTER TABLE identified_levels
    ADD COLUMN IF NOT EXISTS reasoning TEXT;

  ALTER TABLE identified_levels
    ADD COLUMN IF NOT EXISTS timeframe TEXT;

  UPDATE identified_levels SET reasoning = 'Level identified by Agent 1' WHERE reasoning IS NULL;
  UPDATE identified_levels SET timeframe = '4H' WHERE timeframe IS NULL;

  BEGIN
    ALTER TABLE identified_levels ALTER COLUMN reasoning SET NOT NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'reasoning NOT NULL skipped: %', SQLERRM;
  END;

  BEGIN
    ALTER TABLE identified_levels ALTER COLUMN timeframe SET NOT NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'timeframe NOT NULL skipped: %', SQLERRM;
  END;
END $$;


-- ==========================================
-- Migration: 20260713_create_level_breaks.sql
-- ==========================================
-- Create level_breaks table for storing detected level breaks
-- Stores breaks detected by the LevelBreakDetector service

CREATE TABLE IF NOT EXISTS level_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Break identification
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  level DECIMAL(10, 2) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),

  -- Scoring & confidence
  confidence SMALLINT NOT NULL CHECK (confidence >= 0 AND confidence <= 100),

  -- Price data
  entry_price DECIMAL(10, 2) NOT NULL,
  break_price DECIMAL(10, 2) NOT NULL,
  volume BIGINT,

  -- Metadata
  reasoning TEXT NOT NULL,
  score_breakdown JSONB NOT NULL,

  -- Timestamps
  break_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
-- Most common: fetch breaks for an instrument, ordered by timestamp
CREATE INDEX idx_level_breaks_instrument
  ON level_breaks(instrument);

CREATE INDEX idx_level_breaks_created_at
  ON level_breaks(created_at DESC);

-- Filter + sort by instrument and timestamp
CREATE INDEX idx_level_breaks_instrument_timestamp
  ON level_breaks(instrument, break_timestamp DESC);

-- Filter by confidence level
CREATE INDEX idx_level_breaks_confidence
  ON level_breaks(confidence DESC);

-- Group by level
CREATE INDEX idx_level_breaks_instrument_level
  ON level_breaks(instrument, level);

-- Filter by direction
CREATE INDEX idx_level_breaks_direction
  ON level_breaks(direction);

-- JSONB index for scoreBreakdown queries (future use)
CREATE INDEX idx_level_breaks_score_breakdown
  ON level_breaks USING GIN (score_breakdown);

-- Composite timestamp index for date range queries
CREATE INDEX idx_level_breaks_timestamp_range
  ON level_breaks(break_timestamp DESC);

-- Enable Row Level Security (currently simple: all readable)
ALTER TABLE level_breaks ENABLE ROW LEVEL SECURITY;

-- Simple RLS policies for single-user app
-- All breaks are readable
CREATE POLICY "All breaks are readable"
  ON level_breaks FOR SELECT
  USING (true);

-- System can insert breaks
CREATE POLICY "System can insert breaks"
  ON level_breaks FOR INSERT
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260713_create_level_history.sql
-- ==========================================
-- Slice 5: Historical Level Memory - Database Layer
-- Stores identified levels with performance tracking for AI context awareness
-- 30-day rolling retention with auto-deletion of old records

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

-- Indexes for query performance
CREATE INDEX idx_level_history_user_instrument_created
  ON level_history(user_id, instrument, created_at DESC);

CREATE INDEX idx_level_history_user_created
  ON level_history(user_id, created_at DESC);

CREATE INDEX idx_level_history_archived
  ON level_history(archived_at DESC);

-- Enable Row Level Security
ALTER TABLE level_history ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read own level history
CREATE POLICY "Users can read own level history"
  ON level_history FOR SELECT
  USING (user_id = auth.uid());

-- RLS Policy: System can insert level history (for archival process)
CREATE POLICY "System can insert level history"
  ON level_history FOR INSERT
  WITH CHECK (true);

-- RLS Policy: System can update level history (for duplicate detection)
CREATE POLICY "System can update level history"
  ON level_history FOR UPDATE
  USING (true);

-- Comment for documentation
COMMENT ON TABLE level_history IS
  'Archive of identified levels with performance tracking. 30-day rolling retention. Auto-deleted after 30 days via cleanup process.';

COMMENT ON COLUMN level_history.tested_count IS
  'Number of times this level was tested (price touched it across multiple sessions)';

COMMENT ON COLUMN level_history.success_count IS
  'Number of times price successfully reversed at this level';

COMMENT ON COLUMN level_history.archived_at IS
  'When level was archived (used for TTL cleanup, not when originally identified)';


-- ==========================================
-- Migration: 20260713_create_level_monitoring.sql
-- ==========================================
-- Slice 3: Real-Time Level Status Monitoring
-- Creates tables for trading levels and monitoring status

-- Create trading_levels table
CREATE TABLE IF NOT EXISTS trading_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  level_name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  level_type TEXT NOT NULL CHECK (level_type IN ('support', 'resistance', 'pivot')),
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_level UNIQUE(user_id, instrument, price)
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_levels_user_id ON trading_levels(user_id);
CREATE INDEX IF NOT EXISTS idx_levels_user_instrument ON trading_levels(user_id, instrument);
CREATE INDEX IF NOT EXISTS idx_levels_user_instrument_active ON trading_levels(user_id, instrument, is_active);

-- Enable RLS on trading_levels
ALTER TABLE trading_levels ENABLE ROW LEVEL SECURITY;

-- RLS Policies for trading_levels
DROP POLICY IF EXISTS "Users can read own levels" ON trading_levels;
CREATE POLICY "Users can read own levels"
  ON trading_levels FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own levels" ON trading_levels;
CREATE POLICY "Users can create own levels"
  ON trading_levels FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own levels" ON trading_levels;
CREATE POLICY "Users can update own levels"
  ON trading_levels FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own levels" ON trading_levels;
CREATE POLICY "Users can delete own levels"
  ON trading_levels FOR DELETE
  USING (user_id = auth.uid());

-- Create level_monitor_status table
CREATE TABLE IF NOT EXISTS level_monitor_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('connected', 'reconnecting', 'disconnected')),
  last_price DECIMAL(10, 2),
  last_price_update TIMESTAMPTZ,
  reconnect_attempts INT DEFAULT 0,
  last_reconnect_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_instrument UNIQUE (user_id, instrument)
);

-- Create indexes for monitoring status
CREATE INDEX IF NOT EXISTS idx_monitor_status_user_id ON level_monitor_status(user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_status_user_instrument ON level_monitor_status(user_id, instrument);

-- Enable RLS on level_monitor_status
ALTER TABLE level_monitor_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies for level_monitor_status
DROP POLICY IF EXISTS "Users can read own monitoring status" ON level_monitor_status;
CREATE POLICY "Users can read own monitoring status"
  ON level_monitor_status FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System can update monitoring status" ON level_monitor_status;
CREATE POLICY "System can update monitoring status"
  ON level_monitor_status FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "System can insert monitoring status" ON level_monitor_status;
CREATE POLICY "System can insert monitoring status"
  ON level_monitor_status FOR INSERT
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260713_create_management_decisions.sql
-- ==========================================
-- Create management_decisions table for position management audit trail
CREATE TABLE IF NOT EXISTS management_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User reference (CRITICAL for RLS)
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Position reference
  position_id UUID NOT NULL REFERENCES trades_journal(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  trade_date DATE NOT NULL,

  -- Decision details
  decision_type TEXT NOT NULL CHECK (decision_type IN ('HOLD', 'TAKE_PROFIT', 'ADJUST')),
  notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_management_user_id ON management_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_management_position_id ON management_decisions(position_id);
CREATE INDEX IF NOT EXISTS idx_management_created_at ON management_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_management_user_date ON management_decisions(user_id, trade_date DESC);

-- Enable RLS
ALTER TABLE management_decisions ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only view their own decisions
DROP POLICY IF EXISTS "management_users_read_own" ON management_decisions;
CREATE POLICY "management_users_read_own"
  ON management_decisions FOR SELECT
  USING (user_id = auth.uid());

-- RLS: Users can insert their own decisions
DROP POLICY IF EXISTS "management_users_insert_own" ON management_decisions;
CREATE POLICY "management_users_insert_own"
  ON management_decisions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Desk / service inserts (single-trader + cron paths)
DROP POLICY IF EXISTS "management_system_insert" ON management_decisions;
CREATE POLICY "management_system_insert"
  ON management_decisions FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "management_system_read" ON management_decisions;
CREATE POLICY "management_system_read"
  ON management_decisions FOR SELECT
  USING (true);


-- ==========================================
-- Migration: 20260713_create_replay_availability_cache.sql
-- ==========================================
-- Create replay_availability_cache table to cache which dates have Finnhub market data
-- This table is lazily populated as users attempt to create replays

CREATE TABLE IF NOT EXISTS replay_availability_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  replay_date DATE NOT NULL,
  is_available BOOLEAN NOT NULL,
  last_checked TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: only one cache entry per instrument/date combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_replay_availability_unique
  ON replay_availability_cache(instrument, replay_date);

-- Index for efficient lookup by instrument
CREATE INDEX IF NOT EXISTS idx_replay_availability_instrument
  ON replay_availability_cache(instrument);

-- Index for efficient lookup by date range
CREATE INDEX IF NOT EXISTS idx_replay_availability_date
  ON replay_availability_cache(replay_date DESC);

-- Cached Finnhub availability — personal desk (RLS on, desk-wide policies)
-- See 20260717_rls_personal_desk_caches.sql


-- ==========================================
-- Migration: 20260713_create_simulation_replays.sql
-- ==========================================
-- Create simulation_replays table for historical market replay sessions
CREATE TABLE IF NOT EXISTS simulation_replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  replay_date DATE NOT NULL,
  playback_speed INTEGER NOT NULL CHECK (playback_speed IN (1, 2, 4, 16)),

  -- Results (NULL while replay in progress)
  final_pnl NUMERIC(12, 2),
  final_pnl_percent NUMERIC(8, 2),
  trades_count INTEGER DEFAULT 0 CHECK (trades_count >= 0),
  replay_duration_seconds INTEGER CHECK (replay_duration_seconds >= 0),

  -- Trader notes
  notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_simulation_replays_user_id ON simulation_replays(user_id);
CREATE INDEX IF NOT EXISTS idx_simulation_replays_user_created ON simulation_replays(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_replays_instrument_date ON simulation_replays(instrument, replay_date DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_replays_user_instrument ON simulation_replays(user_id, instrument);

-- Unique constraint: only one replay per user, date, and instrument
CREATE UNIQUE INDEX IF NOT EXISTS idx_simulation_replays_unique_session
  ON simulation_replays(user_id, replay_date, instrument);

-- Row Level Security
ALTER TABLE simulation_replays ENABLE ROW LEVEL SECURITY;

-- Users can read their own replay sessions
DROP POLICY IF EXISTS "Users can read own replay sessions" ON simulation_replays;
CREATE POLICY "Users can read own replay sessions"
  ON simulation_replays FOR SELECT
  USING (user_id = auth.uid());

-- Users can create their own replay sessions
DROP POLICY IF EXISTS "Users can create own replay sessions" ON simulation_replays;
CREATE POLICY "Users can create own replay sessions"
  ON simulation_replays FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own replay sessions
DROP POLICY IF EXISTS "Users can update own replay sessions" ON simulation_replays;
CREATE POLICY "Users can update own replay sessions"
  ON simulation_replays FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own replay sessions
DROP POLICY IF EXISTS "Users can delete own replay sessions" ON simulation_replays;
CREATE POLICY "Users can delete own replay sessions"
  ON simulation_replays FOR DELETE
  USING (user_id = auth.uid());


-- ==========================================
-- Migration: 20260713_create_trades_journal.sql
-- ==========================================
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


-- ==========================================
-- Migration: 20260713_regime_cache.sql
-- ==========================================
-- Create regime_cache table for market recommendation data
CREATE TABLE IF NOT EXISTS regime_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  date DATE NOT NULL,

  -- Gap and overnight OHLC
  gap_percent DECIMAL(5, 2) NOT NULL,
  overnight_open DECIMAL(10, 2) NOT NULL,
  overnight_high DECIMAL(10, 2) NOT NULL,
  overnight_low DECIMAL(10, 2) NOT NULL,
  overnight_close DECIMAL(10, 2) NOT NULL,

  -- Regime classification
  regime TEXT NOT NULL CHECK (regime IN ('bullish', 'bearish', 'choppy')),
  regime_confidence SMALLINT NOT NULL CHECK (regime_confidence >= 0 AND regime_confidence <= 100),

  -- News and sentiment
  news_headlines JSONB DEFAULT '[]'::jsonb,
  news_sentiment_score SMALLINT DEFAULT 0,

  -- Level break data from detector
  best_level_break_confidence SMALLINT CHECK (best_level_break_confidence IS NULL OR (best_level_break_confidence >= 0 AND best_level_break_confidence <= 100)),
  best_break_level DECIMAL(10, 2),

  -- Recommendation confidence (final score)
  recommendation_confidence SMALLINT NOT NULL CHECK (recommendation_confidence >= 0 AND recommendation_confidence <= 100),

  -- Scoring breakdown for transparency
  gap_score SMALLINT DEFAULT 0,
  ohlc_score SMALLINT DEFAULT 0,
  news_score SMALLINT DEFAULT 0,
  level_score SMALLINT DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Composite index: instrument + date (typically queried together)
CREATE INDEX IF NOT EXISTS idx_regime_cache_instrument_date ON regime_cache(instrument, date DESC);

-- Index for finding today's recommendations quickly
CREATE INDEX IF NOT EXISTS idx_regime_cache_date ON regime_cache(date DESC);

-- Index for finding best recommendation per day
CREATE INDEX IF NOT EXISTS idx_regime_cache_confidence ON regime_cache(recommendation_confidence DESC);

-- Unique constraint: one row per instrument per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_regime_cache_unique ON regime_cache(instrument, date);

ALTER TABLE regime_cache ENABLE ROW LEVEL SECURITY;

-- RLS: All readable (single-user app)
DROP POLICY IF EXISTS "regime_cache_all_readable" ON regime_cache;
CREATE POLICY "regime_cache_all_readable"
  ON regime_cache FOR SELECT
  USING (true);

-- Only system can insert regime cache
DROP POLICY IF EXISTS "regime_cache_system_insert" ON regime_cache;
CREATE POLICY "regime_cache_system_insert"
  ON regime_cache FOR INSERT
  WITH CHECK (true);

-- System can update regime cache
DROP POLICY IF EXISTS "regime_cache_system_update" ON regime_cache;
CREATE POLICY "regime_cache_system_update"
  ON regime_cache FOR UPDATE
  USING (true);

-- Create market_recommendations table for tracking trader choices
CREATE TABLE IF NOT EXISTS market_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,

  -- Winning recommendation for the day
  recommended_instrument TEXT NOT NULL CHECK (recommended_instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  recommendation_confidence SMALLINT NOT NULL,

  -- All candidates (for comparison)
  all_recommendations JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Trader's choice
  trader_selected_instrument TEXT CHECK (trader_selected_instrument IS NULL OR trader_selected_instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  selected_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_date ON market_recommendations(date DESC);

ALTER TABLE market_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recommendations_all_readable" ON market_recommendations;
CREATE POLICY "recommendations_all_readable"
  ON market_recommendations FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "recommendations_system_write" ON market_recommendations;
CREATE POLICY "recommendations_system_write"
  ON market_recommendations FOR INSERT
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260714_create_entry_discipline.sql
-- ==========================================
-- Slice 4: Entry Discipline System
-- Creates trades_journal for position tracking and entry_discipline_cache for real-time state

CREATE TABLE IF NOT EXISTS trades_journal (
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
CREATE TABLE IF NOT EXISTS entry_discipline_cache (
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

-- CRITICAL FIX: Use constraint name for proper upsert handling
CREATE UNIQUE INDEX idx_entry_cache_user_instrument_date
  ON entry_discipline_cache(user_id, instrument, trade_date);

-- CRITICAL FIX: Add comment about upsert pattern to avoid race conditions
-- Use INSERT ... ON CONFLICT DO UPDATE in API code instead of SELECT/UPDATE pattern
-- This prevents race conditions during high-frequency price updates

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


-- ==========================================
-- Migration: 20260717_create_llm_usage.sql
-- ==========================================
-- Track every LLM call for the desk usage dashboard
CREATE TABLE IF NOT EXISTS public.llm_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('proposer', 'verifier')),
  route TEXT NOT NULL,
  instrument TEXT,
  session_id UUID,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT true,
  levels_proposed INTEGER,
  levels_accepted INTEGER,
  levels_rejected INTEGER,
  error_message TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON public.llm_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_provider ON public.llm_usage (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_route ON public.llm_usage (route, created_at DESC);

ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_read_llm_usage" ON public.llm_usage;
CREATE POLICY "desk_read_llm_usage"
  ON public.llm_usage FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "desk_write_llm_usage" ON public.llm_usage;
CREATE POLICY "desk_write_llm_usage"
  ON public.llm_usage FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260717_rls_personal_desk_caches.sql
-- ==========================================
-- Personal single-trader desk: enable RLS on remaining open tables,
-- with permissive desk policies (not commercial multi-tenant lockdown).

ALTER TABLE public.replay_availability_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_read_replay_cache" ON public.replay_availability_cache;
CREATE POLICY "desk_read_replay_cache"
  ON public.replay_availability_cache FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "desk_write_replay_cache" ON public.replay_availability_cache;
CREATE POLICY "desk_write_replay_cache"
  ON public.replay_availability_cache FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "desk_read_schema_migrations" ON public.schema_migrations;
CREATE POLICY "desk_read_schema_migrations"
  ON public.schema_migrations FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "desk_write_schema_migrations" ON public.schema_migrations;
CREATE POLICY "desk_write_schema_migrations"
  ON public.schema_migrations FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260717_trades_journal_enrichment.sql
-- ==========================================
-- Journal enrichment: entry/exit narrative + take-profit exit reason
ALTER TABLE trades_journal
  ADD COLUMN IF NOT EXISTS entry_reason TEXT,
  ADD COLUMN IF NOT EXISTS exit_notes TEXT,
  ADD COLUMN IF NOT EXISTS profit_target_price DECIMAL(12, 2);

-- Allow take_profit as a first-class exit reason (alongside existing)
DO $$
BEGIN
  ALTER TABLE trades_journal DROP CONSTRAINT IF EXISTS trades_journal_exit_reason_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE trades_journal
  DROP CONSTRAINT IF EXISTS trades_journal_exit_reason_check;

ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_exit_reason_check
  CHECK (
    exit_reason IS NULL
    OR exit_reason IN (
      'stop_hit',
      'manual',
      'lunch_close',
      'ai_signal',
      'take_profit'
    )
  );


-- ==========================================
-- Migration: 20260717_trades_journal_oanda_ids.sql
-- ==========================================
-- Broker execution ids for OANDA practice/live fills
ALTER TABLE trades_journal
  ADD COLUMN IF NOT EXISTS oanda_trade_id TEXT,
  ADD COLUMN IF NOT EXISTS oanda_order_id TEXT,
  ADD COLUMN IF NOT EXISTS broker_fill_price NUMERIC;

CREATE INDEX IF NOT EXISTS idx_trades_journal_oanda_trade
  ON trades_journal(oanda_trade_id)
  WHERE oanda_trade_id IS NOT NULL;


-- ==========================================
-- Migration: 20260717_trades_journal_working_limits.sql
-- ==========================================
-- Working (unfilled) limits vs filled opens; expire unfilled so they leave Positions
ALTER TABLE trades_journal
  ADD COLUMN IF NOT EXISTS fill_status text NOT NULL DEFAULT 'filled';

UPDATE trades_journal
SET fill_status = 'filled'
WHERE fill_status IS NULL OR fill_status = '';

ALTER TABLE trades_journal
  DROP CONSTRAINT IF EXISTS trades_journal_fill_status_check;

ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_fill_status_check
  CHECK (fill_status = ANY (ARRAY['working'::text, 'filled'::text, 'cancelled'::text]));

ALTER TABLE trades_journal
  DROP CONSTRAINT IF EXISTS trades_journal_exit_reason_check;

ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_exit_reason_check
  CHECK (
    (exit_reason IS NULL)
    OR (exit_reason = ANY (ARRAY[
      'stop_hit'::text,
      'manual'::text,
      'lunch_close'::text,
      'ai_signal'::text,
      'take_profit'::text,
      'limit_expired'::text
    ]))
  );

CREATE INDEX IF NOT EXISTS trades_journal_user_date_fill_status_idx
  ON trades_journal (user_id, trade_date, fill_status)
  WHERE exit_timestamp IS NULL;


-- ==========================================
-- Migration: 20260718_create_simulation_trades.sql
-- ==========================================
-- Per-trade paper history for simulation replay (never mixes with live trades_journal)
CREATE TABLE IF NOT EXISTS simulation_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  replay_id UUID REFERENCES simulation_replays(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  replay_date DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  entry_price NUMERIC(14, 4) NOT NULL,
  exit_price NUMERIC(14, 4) NOT NULL,
  stop_loss NUMERIC(14, 4) NOT NULL,
  take_profit NUMERIC(14, 4),
  position_size NUMERIC(14, 4) NOT NULL,
  risk_amount NUMERIC(12, 2) NOT NULL,
  account_size NUMERIC(14, 2) NOT NULL DEFAULT 100000,
  filled_at_unix BIGINT NOT NULL,
  exit_at_unix BIGINT NOT NULL,
  exit_reason TEXT NOT NULL CHECK (exit_reason IN ('stop_hit', 'take_profit', 'manual')),
  profit_loss NUMERIC(12, 2) NOT NULL,
  entry_level NUMERIC(14, 4),
  entry_reason TEXT,
  level_conviction NUMERIC(4, 1),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simulation_trades_user_created
  ON simulation_trades(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_trades_user_replay_date
  ON simulation_trades(user_id, replay_date DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_trades_replay_id
  ON simulation_trades(replay_id);

ALTER TABLE simulation_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own sim trades" ON simulation_trades;
CREATE POLICY "Users can read own sim trades"
  ON simulation_trades FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own sim trades" ON simulation_trades;
CREATE POLICY "Users can create own sim trades"
  ON simulation_trades FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own sim trades" ON simulation_trades;
CREATE POLICY "Users can delete own sim trades"
  ON simulation_trades FOR DELETE
  USING (user_id = auth.uid());


-- ==========================================
-- Migration: 20260718_desk_attendance.sql
-- ==========================================
-- Desk clock-in / clock-out + session level journals
-- Clock-in = "today I trade" — unlocks live chart and enables level reaction AI.
-- Lunch auto clock-out; morning + EOD journals stored on the same row.

CREATE TABLE IF NOT EXISTS public.desk_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('NY', 'TOKYO')),
  session_date DATE NOT NULL,
  instrument TEXT CHECK (instrument IS NULL OR instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  status TEXT NOT NULL DEFAULT 'clocked_in'
    CHECK (status IN ('clocked_in', 'clocked_out', 'missed')),
  clock_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out_at TIMESTAMPTZ,
  clock_out_reason TEXT CHECK (
    clock_out_reason IS NULL OR clock_out_reason IN ('lunch', 'manual', 'eod')
  ),
  traded_instrument TEXT CHECK (
    traded_instrument IS NULL OR traded_instrument IN ('DOW', 'NASDAQ', 'NIKKEI')
  ),
  morning_journal JSONB NOT NULL DEFAULT '{}'::jsonb,
  afternoon_levels JSONB NOT NULL DEFAULT '[]'::jsonb,
  eod_journal JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, market, session_date)
);

CREATE INDEX IF NOT EXISTS idx_desk_attendance_user_date
  ON public.desk_attendance (user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_desk_attendance_status
  ON public.desk_attendance (status, session_date DESC);

ALTER TABLE public.desk_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_attendance_all" ON public.desk_attendance;
CREATE POLICY "desk_attendance_all"
  ON public.desk_attendance FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260718_level_history_last_verdict.sql
-- ==========================================
-- Persist latest market reaction so the desk UI and prompts see hold/break
-- without re-deriving from counts alone.
ALTER TABLE level_history
  ADD COLUMN IF NOT EXISTS last_verdict TEXT
    CHECK (last_verdict IS NULL OR last_verdict IN ('respected', 'contested', 'broken', 'untested'));

ALTER TABLE level_history
  ADD COLUMN IF NOT EXISTS last_outcome TEXT
    CHECK (last_outcome IS NULL OR last_outcome IN ('held', 'broke', 'untested'));

COMMENT ON COLUMN level_history.last_verdict IS
  'Aggregate market reaction from rule grading: respected | contested | broken | untested';

COMMENT ON COLUMN level_history.last_outcome IS
  'Most recent test episode: held | broke | untested';


-- ==========================================
-- Migration: 20260718_simulation_replays_playback_speed_025.sql
-- ==========================================
-- App default is 0.25x; NUMERIC(4,1) rounded 0.25 → 0.3 and failed the check.
ALTER TABLE simulation_replays
  DROP CONSTRAINT IF EXISTS simulation_replays_playback_speed_check;

ALTER TABLE simulation_replays
  ALTER COLUMN playback_speed TYPE NUMERIC(4,2)
  USING playback_speed::numeric;

ALTER TABLE simulation_replays
  ADD CONSTRAINT simulation_replays_playback_speed_check
  CHECK (playback_speed IN (0.25, 0.5, 1, 2, 4, 16));


-- ==========================================
-- Migration: 20260718_simulation_replays_status_half_speed.sql
-- ==========================================
-- Allow 0.5x playback; track explicit session status (in_progress | completed)
ALTER TABLE simulation_replays
  DROP CONSTRAINT IF EXISTS simulation_replays_playback_speed_check;

ALTER TABLE simulation_replays
  ALTER COLUMN playback_speed TYPE NUMERIC(4,1)
  USING playback_speed::numeric;

ALTER TABLE simulation_replays
  ADD CONSTRAINT simulation_replays_playback_speed_check
  CHECK (playback_speed IN (0.5, 1, 2, 4, 16));

ALTER TABLE simulation_replays
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'in_progress'
  CHECK (status IN ('in_progress', 'completed'));

UPDATE simulation_replays
SET status = 'completed'
WHERE status = 'in_progress'
  AND (replay_duration_seconds IS NOT NULL OR final_pnl IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_simulation_replays_user_status
  ON simulation_replays(user_id, status);


-- ==========================================
-- Migration: 20260718_simulation_trades_desk_rls.sql
-- ==========================================
-- Permissive desk policy so single closes persist under DESK_MODE=single
-- (auth.uid() may be null while getOrCreateUser still assigns the desk user id).
DROP POLICY IF EXISTS "Desk can manage sim trades" ON simulation_trades;
CREATE POLICY "Desk can manage sim trades"
  ON simulation_trades FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260719_entry_source.sql
-- ==========================================
-- Provenance: AI level vs structure fallback vs manual chart/ticket entry
ALTER TABLE trades_journal
  ADD COLUMN IF NOT EXISTS entry_source TEXT
  CHECK (entry_source IS NULL OR entry_source IN ('ai', 'structure', 'manual'));

ALTER TABLE simulation_trades
  ADD COLUMN IF NOT EXISTS entry_source TEXT
  CHECK (entry_source IS NULL OR entry_source IN ('ai', 'structure', 'manual'));

CREATE INDEX IF NOT EXISTS idx_trades_journal_entry_source
  ON trades_journal(user_id, trade_date, entry_source);

CREATE INDEX IF NOT EXISTS idx_simulation_trades_entry_source
  ON simulation_trades(user_id, replay_date, entry_source);

COMMENT ON COLUMN trades_journal.entry_source IS 'ai | structure | manual — how the limit was chosen';
COMMENT ON COLUMN simulation_trades.entry_source IS 'ai | structure | manual — how the limit was chosen';


-- ==========================================
-- Migration: 20260719_live_voice_sessions.sql
-- ==========================================
-- Live Voice sessions, turns, and user-spoken level pins (Slice 4)

CREATE TABLE IF NOT EXISTS public.live_voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  market TEXT NOT NULL CHECK (market IN ('NY', 'TOKYO')),
  trade_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, instrument, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_live_voice_sessions_user_date
  ON public.live_voice_sessions (user_id, trade_date DESC);

CREATE TABLE IF NOT EXISTS public.live_voice_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.live_voice_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text TEXT NOT NULL,
  audio_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_voice_turns_session
  ON public.live_voice_turns (session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.live_voice_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.live_voice_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  price NUMERIC NOT NULL,
  side TEXT CHECK (side IS NULL OR side IN ('BUY', 'SHORT')),
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'user_voice'
    CHECK (source IN ('user_voice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, price)
);

CREATE INDEX IF NOT EXISTS idx_live_voice_pins_session
  ON public.live_voice_pins (session_id, created_at ASC);

ALTER TABLE public.live_voice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_voice_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_voice_pins ENABLE ROW LEVEL SECURITY;

-- Permissive desk policies (DESK_MODE=single may have null auth.uid();
-- app always scopes by user_id from resolveDeskUser).
DROP POLICY IF EXISTS "live_voice_sessions_desk" ON public.live_voice_sessions;
CREATE POLICY "live_voice_sessions_desk"
  ON public.live_voice_sessions FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "live_voice_turns_desk" ON public.live_voice_turns;
CREATE POLICY "live_voice_turns_desk"
  ON public.live_voice_turns FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "live_voice_pins_desk" ON public.live_voice_pins;
CREATE POLICY "live_voice_pins_desk"
  ON public.live_voice_pins FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260727_trades_journal_cash_close_exit_reason.sql
-- ==========================================
-- Allow cash_close exit reason for end-of-session auto-flatten
-- (morning/IB confirm at lunch; hard liquidate at marketClose)

ALTER TABLE trades_journal
  DROP CONSTRAINT IF EXISTS trades_journal_exit_reason_check;

ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_exit_reason_check
  CHECK (
    (exit_reason IS NULL)
    OR (exit_reason = ANY (ARRAY[
      'stop_hit'::text,
      'manual'::text,
      'lunch_close'::text,
      'cash_close'::text,
      'ai_signal'::text,
      'take_profit'::text,
      'limit_expired'::text,
      'broker_rejected'::text
    ]))
  );


-- ==========================================
-- Migration: 20260729_trades_journal_range_bucket.sql
-- ==========================================
-- Explicit attempt-bucket attribution recorded at fill time.
--
-- Ladder rebuilds previously classified past fills purely by desk-local clock
-- time (classifyAttemptBucket). Once the IB entry window was widened to stay
-- open through the lunch-range window (10:30-15:15 ET), clock-only
-- classification can no longer tell an IB fill from a Lunch-range fill placed
-- in the same afternoon slice. Persisting the bucket actually attributed at
-- fill time (via price-based range attribution, see serverPlaybookRange.ts)
-- keeps today's ladder rebuild correct after a refresh.
ALTER TABLE trades_journal
  ADD COLUMN IF NOT EXISTS range_bucket TEXT
  CHECK (range_bucket IS NULL OR range_bucket IN ('morning', 'ib', 'lunch_range', 'other'));

COMMENT ON COLUMN trades_journal.range_bucket IS
  'Attempt-ladder bucket attributed at fill time (morning|ib|lunch_range|other) — preferred over clock classification once IB/Lunch windows overlap.';


-- ==========================================
-- Migration: 20260803_desk_attendance_late_join.sql
-- ==========================================
-- Late first clock-in during cash session (after normal open window)
ALTER TABLE public.desk_attendance
  ADD COLUMN IF NOT EXISTS late_join BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.desk_attendance.late_join IS
  'True when first clock-in occurred after cash open (late join). Does not unlock dead books.';


-- ==========================================
-- Migration: 20260815_desk_settings.sql
-- ==========================================
-- Desk-wide settings (risk profile for Leo / Telegram — not browser-only).

CREATE TABLE IF NOT EXISTS public.desk_settings (
  user_id UUID PRIMARY KEY,
  risk_profile TEXT NOT NULL DEFAULT 'oanda_cash'
    CHECK (risk_profile IN ('oanda_cash', 'tradeify_growth_50k')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.desk_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_settings_all" ON public.desk_settings;
CREATE POLICY "desk_settings_all"
  ON public.desk_settings FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260816_questrade_equity_points.sql
-- ==========================================
-- Questrade equity curve snapshots (read-only account size over time).

CREATE TABLE IF NOT EXISTS public.questrade_equity_points (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equity NUMERIC NOT NULL,
  cash NUMERIC,
  market_value NUMERIC,
  currency TEXT NOT NULL DEFAULT 'CAD',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS questrade_equity_points_recorded_idx
  ON public.questrade_equity_points (recorded_at DESC);

ALTER TABLE public.questrade_equity_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "questrade_equity_points_all" ON public.questrade_equity_points;
CREATE POLICY "questrade_equity_points_all"
  ON public.questrade_equity_points FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260816_questrade_session.sql
-- ==========================================
-- Rotated Questrade refresh token for read-only account size / tape.
-- One row. Never used to place or cancel.

CREATE TABLE IF NOT EXISTS public.questrade_session (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  api_server TEXT,
  token_expiry TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.questrade_session ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "questrade_session_all" ON public.questrade_session;
CREATE POLICY "questrade_session_all"
  ON public.questrade_session FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260816_team_signals.sql
-- ==========================================
-- NYC team tape (Questrade) — see-only signals. Never a Tradeify fill.

CREATE TABLE IF NOT EXISTS public.team_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity NUMERIC NOT NULL,
  entry NUMERIC NOT NULL,
  stop NUMERIC,
  target NUMERIC,
  status TEXT NOT NULL DEFAULT 'filled'
    CHECK (status IN ('working', 'filled', 'closed', 'cancelled')),
  filled_at TIMESTAMPTZ,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source_id)
);

CREATE INDEX IF NOT EXISTS team_signals_user_filled_idx
  ON public.team_signals (user_id, filled_at DESC NULLS LAST, created_at DESC);

ALTER TABLE public.team_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_signals_all" ON public.team_signals;
CREATE POLICY "team_signals_all"
  ON public.team_signals FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==========================================
-- Migration: 20260818_trades_journal_gold_crude.sql
-- ==========================================
-- Tradovate off-desk fills (MGC / CL) can land in live order history.
ALTER TABLE trades_journal DROP CONSTRAINT IF EXISTS trades_journal_instrument_check;
ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_instrument_check
  CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text]));


-- ==========================================
-- Migration: 20260819_trades_journal_russell.sql
-- ==========================================
-- Tradovate E-mini Russell (RTY) fills can land in live order history.
ALTER TABLE trades_journal DROP CONSTRAINT IF EXISTS trades_journal_instrument_check;
ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_instrument_check
  CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text, 'RUSSELL'::text]));


-- ==========================================
-- Migration: 20260820_desk_gold_crude.sql
-- ==========================================
-- GOLD / CRUDE as first-class NY desk books (attendance + morning regime board).
ALTER TABLE desk_attendance DROP CONSTRAINT IF EXISTS desk_attendance_instrument_check;
ALTER TABLE desk_attendance
  ADD CONSTRAINT desk_attendance_instrument_check
  CHECK (instrument IS NULL OR instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text]));

ALTER TABLE regime_cache DROP CONSTRAINT IF EXISTS regime_cache_instrument_check;
ALTER TABLE regime_cache
  ADD CONSTRAINT regime_cache_instrument_check
  CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text]));

ALTER TABLE market_recommendations DROP CONSTRAINT IF EXISTS market_recommendations_recommended_instrument_check;
ALTER TABLE market_recommendations
  ADD CONSTRAINT market_recommendations_recommended_instrument_check
  CHECK (recommended_instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text]));


-- ==========================================
-- Migration: 20260827_desk_settings_asia_signals.sql
-- ==========================================
-- Asia overnight OCO overlay + telegram dedupe (GOLD / DOW recipes).

ALTER TABLE public.desk_settings
  ADD COLUMN IF NOT EXISTS asia_signals JSONB NOT NULL DEFAULT '{}'::jsonb;


