-- App default is 0.25x; NUMERIC(4,1) rounded 0.25 → 0.3 and failed the check.
ALTER TABLE simulation_replays
  DROP CONSTRAINT IF EXISTS simulation_replays_playback_speed_check;

ALTER TABLE simulation_replays
  ALTER COLUMN playback_speed TYPE NUMERIC(4,2)
  USING playback_speed::numeric;

ALTER TABLE simulation_replays
  ADD CONSTRAINT simulation_replays_playback_speed_check
  CHECK (playback_speed IN (0.25, 0.5, 1, 2, 4, 16));
