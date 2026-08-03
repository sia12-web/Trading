-- Late first clock-in during cash session (after normal open window)
ALTER TABLE public.desk_attendance
  ADD COLUMN IF NOT EXISTS late_join BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.desk_attendance.late_join IS
  'True when first clock-in occurred after cash open (late join). Does not unlock dead books.';
