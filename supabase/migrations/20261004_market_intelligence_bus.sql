-- Market intelligence bus persistence.
-- Specialists append state. Events stay separate from per-market interpretations.
-- Chart Leo reads the latest evaluated snapshot; it does not own these tables.

CREATE TABLE IF NOT EXISTS public.market_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  markets TEXT[] NOT NULL DEFAULT '{}',
  entities TEXT[] NOT NULL DEFAULT '{}',
  importance TEXT NOT NULL DEFAULT 'LOW',
  headline TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_events_occurred_idx
  ON public.market_events (occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.market_interpretations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key TEXT NOT NULL REFERENCES public.market_events (event_key) ON DELETE CASCADE,
  market TEXT NOT NULL CHECK (market IN ('YM', 'NQ', 'GC', 'CL', 'NK225')),
  agent TEXT NOT NULL,
  expected_effect TEXT NOT NULL,
  horizon TEXT,
  confidence_label TEXT,
  summary TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_key, market, agent)
);

CREATE TABLE IF NOT EXISTS public.market_state_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market TEXT NOT NULL CHECK (market IN ('YM', 'NQ', 'GC', 'CL', 'NK225')),
  source TEXT NOT NULL CHECK (source IN ('evaluated', 'baseline-seed')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state_generated_at TIMESTAMPTZ,
  intraday TEXT,
  short_term TEXT,
  medium_term TEXT,
  confidence NUMERIC,
  confidence_label TEXT,
  primary_driver TEXT,
  snapshot JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS market_state_history_market_time_idx
  ON public.market_state_history (market, recorded_at DESC);

ALTER TABLE public.market_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_interpretations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_state_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "market_events_all" ON public.market_events;
CREATE POLICY "market_events_all" ON public.market_events FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "market_interpretations_all" ON public.market_interpretations;
CREATE POLICY "market_interpretations_all" ON public.market_interpretations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "market_state_history_all" ON public.market_state_history;
CREATE POLICY "market_state_history_all" ON public.market_state_history FOR ALL USING (true) WITH CHECK (true);
