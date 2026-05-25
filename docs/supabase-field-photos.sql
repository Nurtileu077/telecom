-- OPTIQ: bucket для полевых фото (Supabase Dashboard → SQL или Storage UI)

insert into storage.buckets (id, name, public)
values ('field-photos', 'field-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "field_photos_public_read" on storage.objects;
create policy "field_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'field-photos');

drop policy if exists "field_photos_anon_insert" on storage.objects;
drop policy if exists "field_photos_auth_insert" on storage.objects;
create policy "field_photos_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'field-photos');

drop policy if exists "field_photos_anon_delete" on storage.objects;
drop policy if exists "field_photos_auth_delete" on storage.objects;
create policy "field_photos_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'field-photos');

-- NEXT_PUBLIC_SUPABASE_URL=
-- NEXT_PUBLIC_SUPABASE_ANON_KEY=
-- NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH=1  (рекомендуется в проде)
