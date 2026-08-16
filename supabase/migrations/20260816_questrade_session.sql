-- Rotated Questrade refresh token for read-only account size / tape.
-- One row. Never used to place or cancel.

CREATE TABLE IF NOT EXISTS public.questrade_session (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  api_server TEXT,
  token_expiry TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.questrade_session ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "questrade_session_all" ON public.questrade_session;
CREATE POLICY "questrade_session_all"
  ON public.questrade_session FOR ALL
  USING (true)
  WITH CHECK (true);
