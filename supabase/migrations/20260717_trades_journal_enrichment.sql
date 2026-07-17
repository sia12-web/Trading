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
