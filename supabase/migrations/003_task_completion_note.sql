-- A short note staff can leave when they mark a task complete: what they
-- actually did, or what they had to change. Optional, so it stays out of the
-- way of the one-tap Complete button.
alter table tasks add column if not exists completion_note text;
