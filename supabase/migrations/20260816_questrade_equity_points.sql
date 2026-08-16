-- Questrade equity curve snapshots (read-only account size over time).

CREATE TABLE IF NOT EXISTS public.questrade_equity_points (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equity NUMERIC NOT NULL,
  cash NUMERIC,
  market_value NUMERIC,
  currency TEXT NOT NULL DEFAULT 'CAD',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS questrade_equity_points_recorded_idx
  ON public.questrade_equity_points (recorded_at DESC);

ALTER TABLE public.questrade_equity_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "questrade_equity_points_all" ON public.questrade_equity_points;
CREATE POLICY "questrade_equity_points_all"
  ON public.questrade_equity_points FOR ALL
  USING (true)
  WITH CHECK (true);
