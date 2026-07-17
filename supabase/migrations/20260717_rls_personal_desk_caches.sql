-- Personal single-trader desk: enable RLS on remaining open tables,
-- with permissive desk policies (not commercial multi-tenant lockdown).

ALTER TABLE public.replay_availability_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_read_replay_cache" ON public.replay_availability_cache;
CREATE POLICY "desk_read_replay_cache"
  ON public.replay_availability_cache FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "desk_write_replay_cache" ON public.replay_availability_cache;
CREATE POLICY "desk_write_replay_cache"
  ON public.replay_availability_cache FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "desk_read_schema_migrations" ON public.schema_migrations;
CREATE POLICY "desk_read_schema_migrations"
  ON public.schema_migrations FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "desk_write_schema_migrations" ON public.schema_migrations;
CREATE POLICY "desk_write_schema_migrations"
  ON public.schema_migrations FOR ALL
  USING (true)
  WITH CHECK (true);
