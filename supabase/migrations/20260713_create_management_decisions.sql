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
