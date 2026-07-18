-- Working (unfilled) limits vs filled opens; expire unfilled so they leave Positions
ALTER TABLE trades_journal
  ADD COLUMN IF NOT EXISTS fill_status text NOT NULL DEFAULT 'filled';

UPDATE trades_journal
SET fill_status = 'filled'
WHERE fill_status IS NULL OR fill_status = '';

ALTER TABLE trades_journal
  DROP CONSTRAINT IF EXISTS trades_journal_fill_status_check;

ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_fill_status_check
  CHECK (fill_status = ANY (ARRAY['working'::text, 'filled'::text, 'cancelled'::text]));

ALTER TABLE trades_journal
  DROP CONSTRAINT IF EXISTS trades_journal_exit_reason_check;

ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_exit_reason_check
  CHECK (
    (exit_reason IS NULL)
    OR (exit_reason = ANY (ARRAY[
      'stop_hit'::text,
      'manual'::text,
      'lunch_close'::text,
      'ai_signal'::text,
      'take_profit'::text,
      'limit_expired'::text
    ]))
  );

CREATE INDEX IF NOT EXISTS trades_journal_user_date_fill_status_idx
  ON trades_journal (user_id, trade_date, fill_status)
  WHERE exit_timestamp IS NULL;
