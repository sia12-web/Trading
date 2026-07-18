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
