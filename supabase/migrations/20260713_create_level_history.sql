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
