-- ============================================================================
-- Photos move out of the database and into Storage.
--
-- Photos used to be base64 strings inside reports.photos, which meant every
-- month load dragged the images along with it and the row size grew without
-- limit. They now live in a private bucket, and the report keeps only the
-- paths. Old base64 photos are left where they are so historical reports
-- still show — the app reads whichever the report has.
-- ============================================================================

-- Private: nothing in here is reachable by URL. Managers view photos through
-- short-lived signed links the app requests when a report is expanded.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-photos', 'work-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The path is site_id/date/report_id/filename, so the first folder in the name
-- IS the site. That's what makes the storage rules line up exactly with the
-- table rules: same question, "is this one of your sites?".
alter table reports add column if not exists photo_paths text[] default '{}';

drop policy if exists work_photos_manager_all on storage.objects;
drop policy if exists work_photos_assigned_select on storage.objects;
drop policy if exists work_photos_assigned_insert on storage.objects;

-- Managers see and manage every photo.
create policy work_photos_manager_all on storage.objects
  for all to authenticated
  using (bucket_id = 'work-photos' and public.is_manager())
  with check (bucket_id = 'work-photos' and public.is_manager());

-- Staff may read back photos for their own sites (the form shows what they
-- just uploaded) but not for anywhere else.
create policy work_photos_assigned_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'work-photos'
    and (storage.foldername(name))[1] in (select public.my_site_ids())
  );

-- Uploading is allowed only into a site they're assigned to. No update or
-- delete policy for staff: a photo, once filed, is evidence.
create policy work_photos_assigned_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'work-photos'
    and (storage.foldername(name))[1] in (select public.my_site_ids())
  );
