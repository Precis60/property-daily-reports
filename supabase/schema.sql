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

create policy reports_anon        on reports        for all to anon using (true) with check (true);
create policy assigned_anon       on assigned_tasks for all to anon using (true) with check (true);
create policy app_settings_anon   on app_settings   for all to anon using (true) with check (true);
