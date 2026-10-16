-- Multi-Agent Market Intelligence Bus Snapshot & History Table
-- Persists evaluated and baseline snapshots from the 5 Fundamental Specialist Agents
-- (NASDAQ_AGENT -> NQ, DOW_AGENT -> YM, GOLD_AGENT -> GC, OIL_AGENT -> CL, NIKKEI_AGENT -> NK225)
-- consumed by Chart Leo and the Desk News Agent (DESK_NEWS_AGENT).

CREATE TABLE IF NOT EXISTS public.market_intelligence_bus_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market TEXT NOT NULL CHECK (market IN ('NQ', 'YM', 'GC', 'CL', 'NK225')),
  source TEXT NOT NULL CHECK (source IN ('evaluated', 'store_default')),
  intraday_stance TEXT NOT NULL,
  short_term_stance TEXT NOT NULL,
  medium_term_stance TEXT NOT NULL,
  confidence NUMERIC(5, 4),
  confidence_label TEXT NOT NULL,
  primary_driver TEXT,
  catalyst_type TEXT,
  catalyst_surprise TEXT,
  catalyst_magnitude TEXT,
  market_confirmation_status TEXT,
  abnormal_behavior_detected BOOLEAN NOT NULL DEFAULT FALSE,
  abnormal_behavior_type TEXT,
  upcoming_catalysts TEXT,
  what_changed TEXT,
  invalidation TEXT,
  snapshot_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_intelligence_bus_market_recorded_idx
  ON public.market_intelligence_bus_snapshots (market, recorded_at DESC);

ALTER TABLE public.market_intelligence_bus_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "market_intelligence_bus_snapshots_all" ON public.market_intelligence_bus_snapshots;
CREATE POLICY "market_intelligence_bus_snapshots_all"
  ON public.market_intelligence_bus_snapshots
  FOR ALL
  USING (true)
  WITH CHECK (true);
