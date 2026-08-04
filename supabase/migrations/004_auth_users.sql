-- Supabase Auth replaces the PIN gates. A person row is the app-level record
-- (name, role, site access); the auth user is the credential. They're kept
-- separate so a person can exist before they're invited, and so removing a
-- login doesn't erase their reports.
alter table people add column if not exists email        text;
alter table people add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

-- Partial indexes: plenty of people may have neither yet, but no two people
-- can share a login or an address.
create unique index if not exists people_auth_user_id_key on people (auth_user_id) where auth_user_id is not null;
create unique index if not exists people_email_key        on people (lower(email))  where email is not null;
