-- Permissive desk policy so single closes persist under DESK_MODE=single
-- (auth.uid() may be null while getOrCreateUser still assigns the desk user id).
DROP POLICY IF EXISTS "Desk can manage sim trades" ON simulation_trades;
CREATE POLICY "Desk can manage sim trades"
  ON simulation_trades FOR ALL
  USING (true)
  WITH CHECK (true);
