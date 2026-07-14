-- Create management_decisions table for position management audit trail
CREATE TABLE IF NOT EXISTS management_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Position reference
  position_id UUID NOT NULL,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  trade_date DATE NOT NULL,

  -- Decision details
  decision TEXT NOT NULL CHECK (decision IN ('HOLD', 'TAKE_PROFIT', 'ADJUST', 'MONITOR')),
  decision_price DECIMAL(10, 2) NOT NULL CHECK (decision_price > 0),
  decision_time TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,

  -- Context at time of decision
  confidence_at_decision SMALLINT,
  current_p_l DECIMAL(10, 2),
  current_p_l_percent DECIMAL(5, 2),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_management_position_id ON management_decisions(position_id);
CREATE INDEX IF NOT EXISTS idx_management_date ON management_decisions(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_management_decision ON management_decisions(instrument, trade_date, decision);

-- Enable RLS
ALTER TABLE management_decisions ENABLE ROW LEVEL SECURITY;

-- RLS: All readable (single-user app)
DROP POLICY IF EXISTS "management_all_readable" ON management_decisions;
CREATE POLICY "management_all_readable"
  ON management_decisions FOR SELECT
  USING (true);

-- System can insert decisions
DROP POLICY IF EXISTS "management_system_insert" ON management_decisions;
CREATE POLICY "management_system_insert"
  ON management_decisions FOR INSERT
  WITH CHECK (true);
