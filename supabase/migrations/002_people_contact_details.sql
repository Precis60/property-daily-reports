-- Contact details for staff and contractors.
--   phone         — mobile number, so a manager can reach them from the app.
--   business_name — for contractors who trade under a company name.
--   staff_id      — a short payroll-style reference: STF-01 for staff,
--                   CON-01 for contractors. Managers can override it, so it's
--                   a plain column with a uniqueness guard rather than a
--                   generated value. Managers don't get one.
alter table people add column if not exists phone         text;
alter table people add column if not exists business_name text;
alter table people add column if not exists staff_id      text;

-- Partial, so any number of people can have no ID at all while the ones that
-- do are guaranteed distinct.
create unique index if not exists people_staff_id_key
  on people (staff_id) where staff_id is not null;
