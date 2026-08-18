-- Tradovate off-desk fills (MGC / CL) can land in live order history.
ALTER TABLE trades_journal DROP CONSTRAINT IF EXISTS trades_journal_instrument_check;
ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_instrument_check
  CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text]));
