-- Signed-in users hit the API as the `authenticated` role, not `anon`, so the
-- old anon-only policies locked everyone out the moment PINs were replaced by
-- Supabase Auth. Still permissive: real per-site restriction comes with the
-- security step, this only restores parity for logged-in users.
do $$
declare t text;
begin
  foreach t in array array['sites','people','site_assignments','tasks','task_assignees','reports','assigned_tasks','app_settings','manager_schedule'] loop
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
  end loop;
end $$;
