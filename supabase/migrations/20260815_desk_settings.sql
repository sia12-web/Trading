-- Desk-wide settings (risk profile for Leo / Telegram — not browser-only).

CREATE TABLE IF NOT EXISTS public.desk_settings (
  user_id UUID PRIMARY KEY,
  risk_profile TEXT NOT NULL DEFAULT 'oanda_cash'
    CHECK (risk_profile IN ('oanda_cash', 'tradeify_growth_50k')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.desk_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_settings_all" ON public.desk_settings;
CREATE POLICY "desk_settings_all"
  ON public.desk_settings FOR ALL
  USING (true)
  WITH CHECK (true);
