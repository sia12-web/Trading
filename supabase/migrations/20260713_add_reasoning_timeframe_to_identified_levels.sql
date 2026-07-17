-- Migration: Add reasoning and timeframe columns to identified_levels
-- Safe if table/columns already exist (bootstrap may have created them)

DO $$
BEGIN
  IF to_regclass('public.identified_levels') IS NULL THEN
    RAISE NOTICE 'identified_levels missing — skip alter';
    RETURN;
  END IF;

  ALTER TABLE identified_levels
    ADD COLUMN IF NOT EXISTS reasoning TEXT;

  ALTER TABLE identified_levels
    ADD COLUMN IF NOT EXISTS timeframe TEXT;

  UPDATE identified_levels SET reasoning = 'Level identified by Agent 1' WHERE reasoning IS NULL;
  UPDATE identified_levels SET timeframe = '4H' WHERE timeframe IS NULL;

  BEGIN
    ALTER TABLE identified_levels ALTER COLUMN reasoning SET NOT NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'reasoning NOT NULL skipped: %', SQLERRM;
  END;

  BEGIN
    ALTER TABLE identified_levels ALTER COLUMN timeframe SET NOT NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'timeframe NOT NULL skipped: %', SQLERRM;
  END;
END $$;
