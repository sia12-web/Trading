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
