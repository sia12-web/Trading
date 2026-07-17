-- Track every LLM call for the desk usage dashboard
CREATE TABLE IF NOT EXISTS public.llm_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('proposer', 'verifier')),
  route TEXT NOT NULL,
  instrument TEXT,
  session_id UUID,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT true,
  levels_proposed INTEGER,
  levels_accepted INTEGER,
  levels_rejected INTEGER,
  error_message TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON public.llm_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_provider ON public.llm_usage (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_route ON public.llm_usage (route, created_at DESC);

ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_read_llm_usage" ON public.llm_usage;
CREATE POLICY "desk_read_llm_usage"
  ON public.llm_usage FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "desk_write_llm_usage" ON public.llm_usage;
CREATE POLICY "desk_write_llm_usage"
  ON public.llm_usage FOR ALL
  USING (true)
  WITH CHECK (true);
