-- Schema for Property Daily Reports.
-- Run in the Supabase SQL editor.

create table if not exists reports (
  id            text primary key,
  date          date not null,
  worker_name   text,
  worker_type   text,
  arrival       text,
  departure     text,
  hours         numeric,
  tasks         jsonb default '[]'::jsonb,
  photo_count   integer default 0,
  photos        jsonb default '[]'::jsonb,
  delays        text,
  delay_explain text,
  delay_notes   text,
  tomorrow      text,
  full_check    text,
  submitted_at  timestamptz
);
create index if not exists reports_date_idx on reports (date);

create table if not exists assigned_tasks (
  id          text primary key,
  date        date not null,
  task_text   text not null,
  assigned_to jsonb default '[]'::jsonb,
  start_time  text,
  end_time    text,
  acknowledged_by jsonb default '[]'::jsonb,
  created_at  timestamptz default now(),
  active      boolean default true
);
-- For databases created before expected start/finish times existed:
alter table assigned_tasks add column if not exists start_time text;
alter table assigned_tasks add column if not exists end_time   text;
alter table assigned_tasks add column if not exists acknowledged_by jsonb default '[]'::jsonb;
create index if not exists assigned_tasks_active_idx on assigned_tasks (active, date);

create table if not exists sites (
  id         text primary key,
  name       text not null,
  address    text,
  notes      text,
  active     boolean default true,
  created_at timestamptz default now()
);

-- Managers, staff and contractors. Replaces the hardcoded names and the
-- staff_pins blob in app_settings.
create table if not exists people (
  id         text primary key,
  name       text not null,
  role       text not null default 'staff', -- manager | staff | contractor
  pin        text,
  active     boolean default true,
  sort_order integer default 100, -- display order on the home screen
  created_at timestamptz default now()
);
alter table people add column if not exists sort_order integer default 100;

-- Which sites a person can see.
create table if not exists site_assignments (
  person_id  text not null references people (id) on delete cascade,
  site_id    text not null references sites (id) on delete cascade,
  created_at timestamptz default now(),
  primary key (person_id, site_id)
);

alter table reports        add column if not exists site_id text references sites (id);
alter table assigned_tasks add column if not exists site_id text references sites (id);

create index if not exists reports_site_id_idx          on reports (site_id);
create index if not exists assigned_tasks_site_id_idx   on assigned_tasks (site_id);
create index if not exists site_assignments_site_id_idx on site_assignments (site_id);

create table if not exists app_settings (
  id          integer primary key,
  manager_pin text,
  staff_pins  jsonb default '{}'::jsonb
);
insert into app_settings (id, manager_pin, staff_pins)
values (1, '2468', '{"Brett":"1701","Chris":"2802","Contractor One":"5501","Contractor Two":"6602"}'::jsonb)
on conflict (id) do nothing;

-- The app uses the public anon key, so RLS policies are the only access control.
alter table reports        enable row level security;
alter table assigned_tasks enable row level security;
alter table app_settings   enable row level security;
alter table sites            enable row level security;
alter table people           enable row level security;
alter table site_assignments enable row level security;

create policy reports_anon        on reports        for all to anon using (true) with check (true);
create policy assigned_anon       on assigned_tasks for all to anon using (true) with check (true);
create policy app_settings_anon   on app_settings   for all to anon using (true) with check (true);
create policy sites_anon_all       on sites            for all to anon using (true) with check (true);
create policy people_anon_all      on people           for all to anon using (true) with check (true);
create policy site_assignments_anon_all on site_assignments for all to anon using (true) with check (true);

insert into sites (id, name) values
  ('site-01','Site One'),   ('site-02','Site Two'),      ('site-03','Site Three'),   ('site-04','Site Four'),
  ('site-05','Site Five'),  ('site-06','Site Six'),      ('site-07','Site Seven'),   ('site-08','Site Eight'),
  ('site-09','Site Nine'),  ('site-10','Site Ten'),      ('site-11','Site Eleven'),  ('site-12','Site Twelve'),
  ('site-13','Site Thirteen'),('site-14','Site Fourteen'),('site-15','Site Fifteen'),('site-16','Site Sixteen')
on conflict (id) do nothing;

-- Backfill people from the old app_settings PINs (safe to re-run).
insert into people (id, name, role, pin)
select lower(regexp_replace(k, '[^a-zA-Z0-9]+', '-', 'g')),
       k,
       case when k ilike 'contractor%' then 'contractor' else 'staff' end,
       v
from app_settings, lateral jsonb_each_text(staff_pins) as e (k, v)
on conflict (id) do nothing;

insert into people (id, name, role, pin)
select 'manager-1', 'Manager', 'manager', manager_pin from app_settings
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- Manager schedule: each manager's own day, visible to all managers.
-- Items another manager adds land as 'pending' until the owner approves.
create table if not exists manager_schedule (
  id         text primary key,
  owner_id   text not null references people (id) on delete cascade,
  date       date not null,
  start_time text,
  end_time   text,
  title      text not null,
  notes      text,
  site_id    text references sites (id),
  created_by text references people (id),
  status     text not null default 'confirmed', -- confirmed | pending | declined
  decided_at timestamptz,
  active     boolean default true,
  created_at timestamptz default now()
);
create index if not exists manager_schedule_owner_date_idx on manager_schedule (owner_id, date);
create index if not exists manager_schedule_status_idx     on manager_schedule (status);

alter table manager_schedule enable row level security;
create policy manager_schedule_anon_all on manager_schedule for all to anon using (true) with check (true);
