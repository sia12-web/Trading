-- Persist latest market reaction so the desk UI and prompts see hold/break
-- without re-deriving from counts alone.
ALTER TABLE level_history
  ADD COLUMN IF NOT EXISTS last_verdict TEXT
    CHECK (last_verdict IS NULL OR last_verdict IN ('respected', 'contested', 'broken', 'untested'));

ALTER TABLE level_history
  ADD COLUMN IF NOT EXISTS last_outcome TEXT
    CHECK (last_outcome IS NULL OR last_outcome IN ('held', 'broke', 'untested'));

COMMENT ON COLUMN level_history.last_verdict IS
  'Aggregate market reaction from rule grading: respected | contested | broken | untested';

COMMENT ON COLUMN level_history.last_outcome IS
  'Most recent test episode: held | broke | untested';
