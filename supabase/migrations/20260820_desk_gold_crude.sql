-- GOLD / CRUDE as first-class NY desk books (attendance + morning regime board).
ALTER TABLE desk_attendance DROP CONSTRAINT IF EXISTS desk_attendance_instrument_check;
ALTER TABLE desk_attendance
  ADD CONSTRAINT desk_attendance_instrument_check
  CHECK (instrument IS NULL OR instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text]));

ALTER TABLE regime_cache DROP CONSTRAINT IF EXISTS regime_cache_instrument_check;
ALTER TABLE regime_cache
  ADD CONSTRAINT regime_cache_instrument_check
  CHECK (instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text]));

ALTER TABLE market_recommendations DROP CONSTRAINT IF EXISTS market_recommendations_recommended_instrument_check;
ALTER TABLE market_recommendations
  ADD CONSTRAINT market_recommendations_recommended_instrument_check
  CHECK (recommended_instrument = ANY (ARRAY['DOW'::text, 'NASDAQ'::text, 'NIKKEI'::text, 'GOLD'::text, 'CRUDE'::text]));
