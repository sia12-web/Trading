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
