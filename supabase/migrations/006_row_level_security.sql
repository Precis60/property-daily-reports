-- ============================================================================
-- Row Level Security
--
-- Until now every table was readable and writable by anyone holding the anon
-- key, which is published in the browser bundle — site assignment was a UI
-- convenience, not a rule. Now that people sign in with Supabase Auth, the
-- database itself can decide what each person is allowed to touch.
--
-- The shape of it: managers can do everything; everyone else can only reach
-- rows belonging to a site they are assigned to.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
--
-- Policies on `people` can't themselves query `people` without recursing, so
-- these run as the definer (bypassing RLS) and are the single place that
-- answers "who is this and what can they see?".
-- ---------------------------------------------------------------------------

-- The people.id of whoever is signed in, or null for a login with no record.
create or replace function public.auth_person_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from people where auth_user_id = auth.uid() limit 1;
$$;

-- True for the three managers. Managers are deliberately not listed in
-- site_assignments — being a manager is what grants every site.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from people
    where auth_user_id = auth.uid() and role = 'manager' and active
  );
$$;

-- The sites this person may work on. Empty for anyone not yet assigned, which
-- is why an unassigned staff member sees nothing rather than everything.
create or replace function public.my_site_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select sa.site_id
  from site_assignments sa
  where sa.person_id = public.auth_person_id();
$$;

grant execute on function public.auth_person_id, public.is_manager, public.my_site_ids to authenticated;

-- ---------------------------------------------------------------------------
-- Roster view
--
-- Staff can't read the `people` table, but the app still needs a list of names
-- for "who did you work with?" and for showing who a task is assigned to.
-- This view exposes names and nothing else — no email, phone or business.
-- ---------------------------------------------------------------------------
create or replace view public.roster
with (security_invoker = off) as
  select id, name, role, active, sort_order from people;

grant select on public.roster to authenticated;

-- ---------------------------------------------------------------------------
-- Start from a clean slate: drop the permissive policies and shut the door on
-- anon entirely. Nothing is readable without signing in from here on.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sites','people','site_assignments','tasks','task_assignees',
                           'reports','assigned_tasks','app_settings','manager_schedule'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('drop policy if exists "public access" on public.%I', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- sites — managers maintain them; everyone else sees only their own sites, so
-- a staff member's site dropdown can't even offer a property they're not on.
-- ---------------------------------------------------------------------------
create policy sites_manager_all on public.sites
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy sites_assigned_select on public.sites
  for select to authenticated using (id in (select public.my_site_ids()));

-- ---------------------------------------------------------------------------
-- people — the roster is manager territory: it holds emails, phone numbers and
-- business names. A staff member can read and correct their own row and
-- nobody else's, which is what the Account screen needs.
-- ---------------------------------------------------------------------------
create policy people_manager_all on public.people
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy people_self_select on public.people
  for select to authenticated using (auth_user_id = auth.uid());

create policy people_self_update on public.people
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- site_assignments — only a manager decides who works where. Staff may read
-- their own assignments (the app needs them to know which sites to offer) but
-- can't see who else is on a site, and can't assign themselves anywhere.
-- ---------------------------------------------------------------------------
create policy site_assignments_manager_all on public.site_assignments
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy site_assignments_self_select on public.site_assignments
  for select to authenticated using (person_id = public.auth_person_id());

-- ---------------------------------------------------------------------------
-- tasks — managers create and delete them. Staff see the tasks for their own
-- sites and can update them (Pending → In progress → Complete, plus the
-- completion note), but can't create work for themselves or move a task to a
-- different site: the `with check` re-tests the site after the edit.
-- ---------------------------------------------------------------------------
create policy tasks_manager_all on public.tasks
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy tasks_assigned_select on public.tasks
  for select to authenticated using (site_id in (select public.my_site_ids()));

create policy tasks_assigned_update on public.tasks
  for update to authenticated
  using (site_id in (select public.my_site_ids()))
  with check (site_id in (select public.my_site_ids()));

-- ---------------------------------------------------------------------------
-- task_assignees — who each task is for. Visible alongside the task itself;
-- a staff member can only tick their own acknowledgement.
-- ---------------------------------------------------------------------------
create policy task_assignees_manager_all on public.task_assignees
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy task_assignees_assigned_select on public.task_assignees
  for select to authenticated using (
    exists (select 1 from tasks t where t.id = task_id and t.site_id in (select public.my_site_ids()))
  );

create policy task_assignees_self_update on public.task_assignees
  for update to authenticated
  using (person_id = public.auth_person_id())
  with check (person_id = public.auth_person_id());

-- ---------------------------------------------------------------------------
-- reports — a staff member files reports against their own sites and can read
-- and correct reports for those sites. Deleting stays with managers, so a bad
-- day can't be quietly erased. Historical reports with no site are visible to
-- managers only, since there's no site to check them against.
-- ---------------------------------------------------------------------------
create policy reports_manager_all on public.reports
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy reports_assigned_select on public.reports
  for select to authenticated using (site_id in (select public.my_site_ids()));

create policy reports_assigned_insert on public.reports
  for insert to authenticated with check (site_id in (select public.my_site_ids()));

create policy reports_assigned_update on public.reports
  for update to authenticated
  using (site_id in (select public.my_site_ids()))
  with check (site_id in (select public.my_site_ids()));

-- ---------------------------------------------------------------------------
-- assigned_tasks — the older assigned-task list, which predates sites and is
-- addressed by name rather than by site. A staff member sees the ones with
-- their name on them, and updates them only to acknowledge.
-- ---------------------------------------------------------------------------
create policy assigned_tasks_manager_all on public.assigned_tasks
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy assigned_tasks_named_select on public.assigned_tasks
  for select to authenticated using (
    assigned_to ? (select name from people where id = public.auth_person_id())
  );

create policy assigned_tasks_named_update on public.assigned_tasks
  for update to authenticated
  using (assigned_to ? (select name from people where id = public.auth_person_id()))
  with check (assigned_to ? (select name from people where id = public.auth_person_id()));

-- ---------------------------------------------------------------------------
-- manager_schedule and app_settings — managers only, no staff access at all.
-- ---------------------------------------------------------------------------
create policy manager_schedule_manager_all on public.manager_schedule
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy app_settings_manager_all on public.app_settings
  for all to authenticated using (public.is_manager()) with check (public.is_manager());
