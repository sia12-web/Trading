-- Empirical Wyckoff 5-Minute Range Backtest Benchmarks & Monthly Historical Ingestion Tables
-- Allows monthly benchmark snapshots and qualified 5m Wyckoff range events to be appended
-- and queried across all 5 desk markets (NASDAQ, DOW, CRUDE, GOLD, NIKKEI) with zero drift.

CREATE TABLE IF NOT EXISTS public.wyckoff_monthly_ingestion_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_month TEXT NOT NULL UNIQUE, -- e.g. '2026-10'
  sample_period TEXT NOT NULL DEFAULT 'Last 365 Days',
  timeframe TEXT NOT NULL DEFAULT '5m',
  total_ranges_analyzed INTEGER NOT NULL,
  accumulation_ranges INTEGER NOT NULL,
  distribution_ranges INTEGER NOT NULL,
  overall_spring_rate_pct NUMERIC(6, 2) NOT NULL,
  overall_lps_rate_pct NUMERIC(6, 2) NOT NULL,
  overall_utad_rate_pct NUMERIC(6, 2) NOT NULL,
  overall_lpsy_rate_pct NUMERIC(6, 2) NOT NULL,
  sweep_depth_avg_atr NUMERIC(6, 2) NOT NULL,
  avg_breakout_atr_expansion NUMERIC(6, 2) NOT NULL,
  asia_formation_pct NUMERIC(6, 2) NOT NULL,
  london_formation_pct NUMERIC(6, 2) NOT NULL,
  overnight_formation_pct NUMERIC(6, 2) NOT NULL,
  summary_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wyckoff_market_benchmarks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_month TEXT NOT NULL REFERENCES public.wyckoff_monthly_ingestion_log (snapshot_month) ON DELETE CASCADE,
  market TEXT NOT NULL CHECK (market IN ('NASDAQ', 'DOW', 'CRUDE', 'GOLD', 'NIKKEI')),
  contract_label TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '5m',
  total_ranges INTEGER NOT NULL,
  accumulation_count INTEGER NOT NULL,
  distribution_count INTEGER NOT NULL,
  spring_rate_pct NUMERIC(6, 2) NOT NULL,
  lps_rate_pct NUMERIC(6, 2) NOT NULL,
  utad_rate_pct NUMERIC(6, 2) NOT NULL,
  lpsy_rate_pct NUMERIC(6, 2) NOT NULL,
  sweep_volume_multiplier NUMERIC(6, 2) NOT NULL,
  avg_range_duration_hours NUMERIC(6, 2) NOT NULL,
  atr_expansion_ratio NUMERIC(6, 2) NOT NULL,
  asia_formation_pct NUMERIC(6, 2) NOT NULL,
  london_formation_pct NUMERIC(6, 2) NOT NULL,
  overnight_formation_pct NUMERIC(6, 2) NOT NULL,
  top_ignition_hours_et TEXT[] NOT NULL DEFAULT '{}',
  top_formation_sessions TEXT[] NOT NULL DEFAULT '{}',
  character_profile TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_month, market, timeframe)
);

CREATE INDEX IF NOT EXISTS wyckoff_market_benchmarks_market_month_idx
  ON public.wyckoff_market_benchmarks (market, snapshot_month DESC);

CREATE TABLE IF NOT EXISTS public.wyckoff_range_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  range_key TEXT NOT NULL UNIQUE, -- deterministic key: market + start_time + end_time
  snapshot_month TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('NASDAQ', 'DOW', 'CRUDE', 'GOLD', 'NIKKEI')),
  timeframe TEXT NOT NULL DEFAULT '5m',
  classification TEXT NOT NULL CHECK (classification IN ('ACCUMULATION', 'DISTRIBUTION')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  breakout_time TIMESTAMPTZ NOT NULL,
  duration_bars INTEGER NOT NULL,
  duration_hours NUMERIC(8, 2) NOT NULL,
  range_low NUMERIC(14, 4) NOT NULL,
  range_high NUMERIC(14, 4) NOT NULL,
  range_width NUMERIC(14, 4) NOT NULL,
  range_atr NUMERIC(14, 4) NOT NULL,
  had_spring_or_utad BOOLEAN NOT NULL DEFAULT FALSE,
  sweep_depth_atr NUMERIC(8, 2) NOT NULL DEFAULT 0,
  sweep_volume_ratio NUMERIC(8, 2) NOT NULL DEFAULT 0,
  cvd_divergence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  net_range_cvd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  breakout_volume_ratio NUMERIC(8, 2) NOT NULL DEFAULT 0,
  atr_expansion_ratio NUMERIC(8, 2) NOT NULL DEFAULT 0,
  post_breakout_mfe_atr NUMERIC(8, 2) NOT NULL DEFAULT 0,
  formation_session TEXT NOT NULL,
  breakout_session TEXT NOT NULL,
  breakout_hour_et INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wyckoff_range_events_market_start_idx
  ON public.wyckoff_range_events (market, start_time DESC);

CREATE INDEX IF NOT EXISTS wyckoff_range_events_classification_idx
  ON public.wyckoff_range_events (market, classification, had_spring_or_utad);

ALTER TABLE public.wyckoff_monthly_ingestion_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wyckoff_market_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wyckoff_range_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wyckoff_monthly_ingestion_log_all" ON public.wyckoff_monthly_ingestion_log;
CREATE POLICY "wyckoff_monthly_ingestion_log_all" ON public.wyckoff_monthly_ingestion_log FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "wyckoff_market_benchmarks_all" ON public.wyckoff_market_benchmarks;
CREATE POLICY "wyckoff_market_benchmarks_all" ON public.wyckoff_market_benchmarks FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "wyckoff_range_events_all" ON public.wyckoff_range_events;
CREATE POLICY "wyckoff_range_events_all" ON public.wyckoff_range_events FOR ALL USING (true) WITH CHECK (true);
