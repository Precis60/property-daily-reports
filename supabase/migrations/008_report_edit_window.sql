-- ---------------------------------------------------------------------------
-- 008 — staff may reopen a report while it's still current
--
-- Reports are now built up through the day rather than written once at the
-- end, so staff need UPDATE on their own reports. That can't stay open
-- forever: once a day is closed it is the manager's record. Staff may change
-- a report only if it is their own and dated today or yesterday (late
-- finishes), on a site they're assigned to. Managers are unaffected.
-- ---------------------------------------------------------------------------
drop policy if exists reports_assigned_update on public.reports;

create policy reports_own_recent_update on public.reports
  for update to authenticated
  using (
    site_id in (select public.my_site_ids())
    and worker_name = (select name from public.people where id = public.auth_person_id())
    and date >= current_date - interval '1 day'
  )
  with check (
    site_id in (select public.my_site_ids())
    and worker_name = (select name from public.people where id = public.auth_person_id())
    and date >= current_date - interval '1 day'
  );

-- Removing a photo while editing has to remove the file too, or the bucket
-- fills with orphans. Staff may delete only within their assigned sites.
drop policy if exists work_photos_assigned_delete on storage.objects;

create policy work_photos_assigned_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'work-photos'
    and (storage.foldername(name))[1] in (select public.my_site_ids())
  );
