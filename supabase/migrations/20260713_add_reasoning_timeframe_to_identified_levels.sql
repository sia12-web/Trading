-- Migration: Add reasoning and timeframe columns to identified_levels
-- These columns are required for Agent 1 (Level Finder) analysis output
-- and for historical level memory context

ALTER TABLE identified_levels
ADD COLUMN IF NOT EXISTS reasoning TEXT;

ALTER TABLE identified_levels
ADD COLUMN IF NOT EXISTS timeframe TEXT CHECK (timeframe IN ('D', '4H', 'H1'));

-- Backfill with sensible defaults for any existing levels
UPDATE identified_levels SET reasoning = 'Level identified by Agent 1' WHERE reasoning IS NULL;
UPDATE identified_levels SET timeframe = '4H' WHERE timeframe IS NULL;

-- Make columns NOT NULL after backfill
ALTER TABLE identified_levels
ALTER COLUMN reasoning SET NOT NULL;

ALTER TABLE identified_levels
ALTER COLUMN timeframe SET NOT NULL;
