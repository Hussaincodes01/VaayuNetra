-- Storage buckets.
--   evidence     public read (PNG chips, plume overlays); written by the worker (service role)
--   dossiers     public read (site dossiers, HTML/PDF); written by the worker (service role)
--   attachments  officers only; files are served through signed URLs

insert into storage.buckets (id, name, public)
values
  ('evidence', 'evidence', true),
  ('dossiers', 'dossiers', true),
  ('attachments', 'attachments', false)
on conflict (id) do update set public = excluded.public;

create policy "evidence and dossiers are public" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('evidence', 'dossiers'));

create policy "officers read attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.has_role('officer'));

create policy "officers upload attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.has_role('officer'));

create policy "admins delete attachments" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and public.has_role('admin'));
