-- Relax instrument check constraints across all desk tables to support GOLD, CRUDE, and RUSSELL

-- 1. trades_journal
ALTER TABLE trades_journal DROP CONSTRAINT IF EXISTS trades_journal_instrument_check;
ALTER TABLE trades_journal
  ADD CONSTRAINT trades_journal_instrument_check
  CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text, 'RUSSELL'::text]));

-- 2. desk_attendance
ALTER TABLE desk_attendance DROP CONSTRAINT IF EXISTS desk_attendance_instrument_check;
ALTER TABLE desk_attendance
  ADD CONSTRAINT desk_attendance_instrument_check
  CHECK (instrument IS NULL OR instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text, 'RUSSELL'::text]));

ALTER TABLE desk_attendance DROP CONSTRAINT IF EXISTS desk_attendance_traded_instrument_check;
ALTER TABLE desk_attendance
  ADD CONSTRAINT desk_attendance_traded_instrument_check
  CHECK (traded_instrument IS NULL OR traded_instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text, 'RUSSELL'::text]));

-- 3. entry_discipline
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'entry_discipline') THEN
    ALTER TABLE entry_discipline DROP CONSTRAINT IF EXISTS entry_discipline_instrument_check;
    ALTER TABLE entry_discipline
      ADD CONSTRAINT entry_discipline_instrument_check
      CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text, 'RUSSELL'::text]));
  END IF;
END $$;

-- 4. simulation_trades
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'simulation_trades') THEN
    ALTER TABLE simulation_trades DROP CONSTRAINT IF EXISTS simulation_trades_instrument_check;
    ALTER TABLE simulation_trades
      ADD CONSTRAINT simulation_trades_instrument_check
      CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text, 'RUSSELL'::text]));
  END IF;
END $$;

-- 5. regime_cache
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'regime_cache') THEN
    ALTER TABLE regime_cache DROP CONSTRAINT IF EXISTS regime_cache_instrument_check;
    ALTER TABLE regime_cache
      ADD CONSTRAINT regime_cache_instrument_check
      CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text, 'RUSSELL'::text]));
  END IF;
END $$;

-- 6. market_recommendations
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'market_recommendations') THEN
    ALTER TABLE market_recommendations DROP CONSTRAINT IF EXISTS market_recommendations_recommended_instrument_check;
    ALTER TABLE market_recommendations
      ADD CONSTRAINT market_recommendations_recommended_instrument_check
      CHECK (recommended_instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text, 'RUSSELL'::text]));
  END IF;
END $$;
