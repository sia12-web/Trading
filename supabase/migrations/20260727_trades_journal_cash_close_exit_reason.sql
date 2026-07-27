-- Allow cash_close exit reason for end-of-session auto-flatten
-- (morning/IB confirm at lunch; hard liquidate at marketClose)

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
      'cash_close'::text,
      'ai_signal'::text,
      'take_profit'::text,
      'limit_expired'::text,
      'broker_rejected'::text
    ]))
  );
