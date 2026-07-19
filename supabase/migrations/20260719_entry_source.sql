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
