-- ===================================================================
-- Multi-site data model for the property maintenance app.
--
-- Safe to run more than once: every statement is guarded with
-- "if not exists" / "on conflict do nothing", so re-running it never
-- duplicates rows or drops anything.
--
-- Tables, in plain English:
--   sites            — the properties you look after.
--   people           — everyone who uses the app: managers, staff, contractors.
--   site_assignments — which people are allowed to work on which sites.
--   tasks            — the live job list for a site on a given day.
--   task_assignees   — which people each live task is for.
--   reports          — the end-of-day summary a worker submits (existing table,
--                      now carries the site it relates to).
-- ===================================================================

-- -------------------------------------------------------------------
-- 1. sites — one row per property.
--    'id' is a short readable code (site-01 … site-16) rather than a
--    random UUID, so it's legible in URLs, exports and support calls.
--    Sites are never deleted, only flagged inactive, because reports
--    and tasks point back at them forever.
-- -------------------------------------------------------------------
create table if not exists sites (
  id         text primary key,
  name       text not null,
  address    text,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists sites_active_idx on sites (active);

-- -------------------------------------------------------------------
-- 2. people — everyone with a login, whatever their role.
--    role decides what they can do: 'manager' sees everything,
--    'staff' and 'contractor' only submit reports and see their tasks.
--    pin is the current PIN-based login. It is deliberately a plain
--    column for now; it moves to Supabase Auth in the security phase.
--    sort_order controls the on-screen order (alphabetical would put
--    "Contractor Eight" before "Contractor Five").
-- -------------------------------------------------------------------
create table if not exists people (
  id         text primary key,
  name       text not null,
  role       text not null default 'staff'
             check (role in ('manager', 'staff', 'contractor')),
  pin        text,
  active     boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create index if not exists people_role_active_idx on people (role, active);

-- Applied separately so an existing people table picks the check up too.
alter table people drop constraint if exists people_role_check;
alter table people add  constraint people_role_check check (role in ('manager', 'staff', 'contractor'));

-- -------------------------------------------------------------------
-- 3. site_assignments — the many-to-many link between people and sites.
--    One row means "this person may work on this site". A person can
--    have any number of sites, and a site any number of people.
--    The primary key is the pair, so the same person can't be added to
--    the same site twice. Both foreign keys cascade: remove a person or
--    a site and their assignment rows disappear with them.
--    Managers are NOT listed here — they implicitly get every site.
-- -------------------------------------------------------------------
create table if not exists site_assignments (
  person_id  text not null references people (id) on delete cascade,
  site_id    text not null references sites (id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, site_id)
);

create index if not exists site_assignments_site_idx   on site_assignments (site_id);
create index if not exists site_assignments_person_idx on site_assignments (person_id);

-- -------------------------------------------------------------------
-- 4. tasks — the live job list: what's happening at a site on a day,
--    updated as the day goes on rather than written once at the end.
--
--    status is the whole point of the table — it moves
--      todo → in_progress → done (or blocked / cancelled)
--    and status_changed_at records when it last moved, which is what
--    lets a manager see "started 40 minutes ago" rather than just a flag.
--
--    scheduled_start / scheduled_end are the plan; actual_start /
--    actual_end are what really happened. Keeping both means you can
--    compare estimated against actual without losing either.
--
--    Tasks are soft-deleted (active = false) so a removed task doesn't
--    vanish from history.
-- -------------------------------------------------------------------
create table if not exists tasks (
  id                text primary key,
  site_id           text not null references sites (id) on delete restrict,
  date              date not null,
  title             text not null,
  details           text,
  status            text not null default 'todo'
                    check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  status_changed_at timestamptz not null default now(),
  priority          text not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'urgent')),
  scheduled_start   text,   -- 'HH:MM', matches the existing time columns
  scheduled_end     text,
  actual_start      timestamptz,
  actual_end        timestamptz,
  blocked_reason    text,
  created_by        text references people (id) on delete set null,
  updated_by        text references people (id) on delete set null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The two queries the app actually runs: "today's board for one site"
-- and "everything still open across all sites".
create index if not exists tasks_site_date_idx on tasks (site_id, date) where active;
create index if not exists tasks_open_idx      on tasks (date, status) where active and status <> 'done';

-- -------------------------------------------------------------------
-- 5. task_assignees — which people a live task is for.
--    A separate table rather than a list inside tasks, so you can ask
--    "what is Brett on today?" with a plain indexed join instead of
--    searching inside JSON.
--    acknowledged_at is the worker confirming they've seen it.
-- -------------------------------------------------------------------
create table if not exists task_assignees (
  task_id         text not null references tasks (id)  on delete cascade,
  person_id       text not null references people (id) on delete cascade,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (task_id, person_id)
);

create index if not exists task_assignees_person_idx on task_assignees (person_id);

-- -------------------------------------------------------------------
-- 6. reports — existing table, now linked to a site.
--    Nullable on purpose: reports submitted before sites existed have
--    no site, and forcing a value would invalidate them. Once every
--    row is backfilled this can become "not null".
-- -------------------------------------------------------------------
alter table reports        add column if not exists site_id text references sites (id);
alter table assigned_tasks add column if not exists site_id text references sites (id);

create index if not exists reports_site_date_idx  on reports (site_id, date);
create index if not exists assigned_tasks_site_idx on assigned_tasks (site_id);

-- -------------------------------------------------------------------
-- Row level security.
--
-- WARNING: these policies are wide open to the anonymous key on
-- purpose, because the app is a static site with no login server yet.
-- They are a placeholder. Anyone with the site URL can read and write
-- these tables through the API — site assignment is currently a UI
-- convenience, not enforced access control. The security phase replaces
-- every policy below with per-user rules based on Supabase Auth.
-- -------------------------------------------------------------------
alter table sites            enable row level security;
alter table people           enable row level security;
alter table site_assignments enable row level security;
alter table tasks            enable row level security;
alter table task_assignees   enable row level security;

drop policy if exists sites_anon_all            on sites;
drop policy if exists people_anon_all           on people;
drop policy if exists site_assignments_anon_all on site_assignments;
drop policy if exists tasks_anon_all            on tasks;
drop policy if exists task_assignees_anon_all   on task_assignees;

create policy sites_anon_all            on sites            for all to anon using (true) with check (true);
create policy people_anon_all           on people           for all to anon using (true) with check (true);
create policy site_assignments_anon_all on site_assignments for all to anon using (true) with check (true);
create policy tasks_anon_all            on tasks            for all to anon using (true) with check (true);
create policy task_assignees_anon_all   on task_assignees   for all to anon using (true) with check (true);

-- -------------------------------------------------------------------
-- Seed data: the 16 sites. Names are placeholders until the real
-- property names and addresses are supplied; the IDs are permanent.
-- -------------------------------------------------------------------
insert into sites (id, name) values
  ('site-01','Site One'),      ('site-02','Site Two'),      ('site-03','Site Three'),   ('site-04','Site Four'),
  ('site-05','Site Five'),     ('site-06','Site Six'),      ('site-07','Site Seven'),   ('site-08','Site Eight'),
  ('site-09','Site Nine'),     ('site-10','Site Ten'),      ('site-11','Site Eleven'),  ('site-12','Site Twelve'),
  ('site-13','Site Thirteen'), ('site-14','Site Fourteen'), ('site-15','Site Fifteen'), ('site-16','Site Sixteen')
on conflict (id) do nothing;
