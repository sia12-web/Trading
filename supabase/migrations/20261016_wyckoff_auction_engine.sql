-- =============================================================================
-- TradePulse Wyckoff Multi-Timeframe Auction Intelligence Engine (1D / 30m / 5m)
-- Persists detected trading ranges, causal lifecycle transitions, and deduplicated alerts
-- across NASDAQ (NQ), DOW (YM), GOLD (GC), CRUDE (CL), and NIKKEI (NK225).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wyckoff_detected_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  range_id TEXT NOT NULL UNIQUE,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1D', '30m', '5m')),
  range_high DOUBLE PRECISION NOT NULL,
  range_low DOUBLE PRECISION NOT NULL,
  range_midpoint DOUBLE PRECISION NOT NULL,
  poc DOUBLE PRECISION,
  vah DOUBLE PRECISION,
  val DOUBLE PRECISION,
  width_pts DOUBLE PRECISION NOT NULL,
  width_atr DOUBLE PRECISION,
  duration_bars INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  overlap_ratio DOUBLE PRECISION NOT NULL,
  classification TEXT NOT NULL,
  provisional_phase TEXT NOT NULL,
  phase_explanation TEXT,
  first_identified_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wyckoff_detected_ranges_inst_tf
  ON public.wyckoff_detected_ranges (instrument, timeframe, last_updated_at DESC);

CREATE TABLE IF NOT EXISTS public.wyckoff_lifecycle_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1D', '30m', '5m')),
  range_id TEXT,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  candidate_event TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  evidence TEXT NOT NULL,
  transition_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wyckoff_lifecycle_transitions_inst_tf
  ON public.wyckoff_lifecycle_transitions (instrument, timeframe, transition_time DESC);

CREATE TABLE IF NOT EXISTS public.wyckoff_auction_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1D', '30m', '5m')),
  monitoring_status TEXT NOT NULL,
  lifecycle_stage TEXT NOT NULL,
  candidate_event TEXT NOT NULL,
  headline TEXT NOT NULL,
  observed_condition TEXT NOT NULL,
  evidence TEXT NOT NULL,
  alert_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wyckoff_auction_alerts_inst_time
  ON public.wyckoff_auction_alerts (instrument, alert_time DESC);
