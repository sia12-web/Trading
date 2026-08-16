-- NYC team tape (Questrade) — see-only signals. Never a Tradeify fill.

CREATE TABLE IF NOT EXISTS public.team_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity NUMERIC NOT NULL,
  entry NUMERIC NOT NULL,
  stop NUMERIC,
  target NUMERIC,
  status TEXT NOT NULL DEFAULT 'filled'
    CHECK (status IN ('working', 'filled', 'closed', 'cancelled')),
  filled_at TIMESTAMPTZ,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source_id)
);

CREATE INDEX IF NOT EXISTS team_signals_user_filled_idx
  ON public.team_signals (user_id, filled_at DESC NULLS LAST, created_at DESC);

ALTER TABLE public.team_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_signals_all" ON public.team_signals;
CREATE POLICY "team_signals_all"
  ON public.team_signals FOR ALL
  USING (true)
  WITH CHECK (true);
