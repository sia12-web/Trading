-- Desk clock-in / clock-out + session level journals
-- Clock-in = "today I trade" — unlocks live chart and enables level reaction AI.
-- Lunch auto clock-out; morning + EOD journals stored on the same row.

CREATE TABLE IF NOT EXISTS public.desk_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('NY', 'TOKYO')),
  session_date DATE NOT NULL,
  instrument TEXT CHECK (instrument IS NULL OR instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  status TEXT NOT NULL DEFAULT 'clocked_in'
    CHECK (status IN ('clocked_in', 'clocked_out', 'missed')),
  clock_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out_at TIMESTAMPTZ,
  clock_out_reason TEXT CHECK (
    clock_out_reason IS NULL OR clock_out_reason IN ('lunch', 'manual', 'eod')
  ),
  traded_instrument TEXT CHECK (
    traded_instrument IS NULL OR traded_instrument IN ('DOW', 'NASDAQ', 'NIKKEI')
  ),
  morning_journal JSONB NOT NULL DEFAULT '{}'::jsonb,
  afternoon_levels JSONB NOT NULL DEFAULT '[]'::jsonb,
  eod_journal JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, market, session_date)
);

CREATE INDEX IF NOT EXISTS idx_desk_attendance_user_date
  ON public.desk_attendance (user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_desk_attendance_status
  ON public.desk_attendance (status, session_date DESC);

ALTER TABLE public.desk_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_attendance_all" ON public.desk_attendance;
CREATE POLICY "desk_attendance_all"
  ON public.desk_attendance FOR ALL
  USING (true)
  WITH CHECK (true);
