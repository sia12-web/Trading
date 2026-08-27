-- Asia overnight OCO overlay + telegram dedupe (GOLD / DOW recipes).

ALTER TABLE public.desk_settings
  ADD COLUMN IF NOT EXISTS asia_signals JSONB NOT NULL DEFAULT '{}'::jsonb;
