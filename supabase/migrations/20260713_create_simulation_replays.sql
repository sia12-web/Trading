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
