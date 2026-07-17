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
