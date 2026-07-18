-- Allow 0.5x playback; track explicit session status (in_progress | completed)
ALTER TABLE simulation_replays
  DROP CONSTRAINT IF EXISTS simulation_replays_playback_speed_check;

ALTER TABLE simulation_replays
  ALTER COLUMN playback_speed TYPE NUMERIC(4,1)
  USING playback_speed::numeric;

ALTER TABLE simulation_replays
  ADD CONSTRAINT simulation_replays_playback_speed_check
  CHECK (playback_speed IN (0.5, 1, 2, 4, 16));

ALTER TABLE simulation_replays
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'in_progress'
  CHECK (status IN ('in_progress', 'completed'));

UPDATE simulation_replays
SET status = 'completed'
WHERE status = 'in_progress'
  AND (replay_duration_seconds IS NOT NULL OR final_pnl IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_simulation_replays_user_status
  ON simulation_replays(user_id, status);
