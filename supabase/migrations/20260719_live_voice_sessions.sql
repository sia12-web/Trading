-- Live Voice sessions, turns, and user-spoken level pins (Slice 4)

CREATE TABLE IF NOT EXISTS public.live_voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  market TEXT NOT NULL CHECK (market IN ('NY', 'TOKYO')),
  trade_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, instrument, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_live_voice_sessions_user_date
  ON public.live_voice_sessions (user_id, trade_date DESC);

CREATE TABLE IF NOT EXISTS public.live_voice_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.live_voice_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text TEXT NOT NULL,
  audio_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_voice_turns_session
  ON public.live_voice_turns (session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.live_voice_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.live_voice_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  price NUMERIC NOT NULL,
  side TEXT CHECK (side IS NULL OR side IN ('BUY', 'SHORT')),
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'user_voice'
    CHECK (source IN ('user_voice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, price)
);

CREATE INDEX IF NOT EXISTS idx_live_voice_pins_session
  ON public.live_voice_pins (session_id, created_at ASC);

ALTER TABLE public.live_voice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_voice_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_voice_pins ENABLE ROW LEVEL SECURITY;

-- Permissive desk policies (DESK_MODE=single may have null auth.uid();
-- app always scopes by user_id from resolveDeskUser).
DROP POLICY IF EXISTS "live_voice_sessions_desk" ON public.live_voice_sessions;
CREATE POLICY "live_voice_sessions_desk"
  ON public.live_voice_sessions FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "live_voice_turns_desk" ON public.live_voice_turns;
CREATE POLICY "live_voice_turns_desk"
  ON public.live_voice_turns FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "live_voice_pins_desk" ON public.live_voice_pins;
CREATE POLICY "live_voice_pins_desk"
  ON public.live_voice_pins FOR ALL
  USING (true)
  WITH CHECK (true);
