-- Explicit attempt-bucket attribution recorded at fill time.
--
-- Ladder rebuilds previously classified past fills purely by desk-local clock
-- time (classifyAttemptBucket). Once the IB entry window was widened to stay
-- open through the lunch-range window (10:30-15:15 ET), clock-only
-- classification can no longer tell an IB fill from a Lunch-range fill placed
-- in the same afternoon slice. Persisting the bucket actually attributed at
-- fill time (via price-based range attribution, see serverPlaybookRange.ts)
-- keeps today's ladder rebuild correct after a refresh.
ALTER TABLE trades_journal
  ADD COLUMN IF NOT EXISTS range_bucket TEXT
  CHECK (range_bucket IS NULL OR range_bucket IN ('morning', 'ib', 'lunch_range', 'other'));

COMMENT ON COLUMN trades_journal.range_bucket IS
  'Attempt-ladder bucket attributed at fill time (morning|ib|lunch_range|other) — preferred over clock classification once IB/Lunch windows overlap.';
