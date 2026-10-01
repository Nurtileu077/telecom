-- OPTIQ: bucket для полевых фото (Supabase Dashboard → SQL или Storage UI)
--
-- Нужны функции optiq_current_org() и optiq_current_role() — они в
-- docs/supabase-org-scope.sql, выполнить его раньше этого файла.

insert into storage.buckets (id, name, public)
values ('field-photos', 'field-photos', true)
on conflict (id) do update set public = true;

-- Читать — всем по прямой ссылке: снимки открывают с телефона.
drop policy if exists "field_photos_public_read" on storage.objects;
create policy "field_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'field-photos');

-- Класть и удалять — только тем, кому выдана организация. Регистрация
-- открыта, и «любой вошедший» значит «кто угодно»: так можно было стереть
-- снимки со стройки, а они — доказательства к актам.
drop policy if exists "field_photos_anon_insert" on storage.objects;
drop policy if exists "field_photos_auth_insert" on storage.objects;
create policy "field_photos_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'field-photos' and public.optiq_current_org() is not null);

drop policy if exists "field_photos_anon_delete" on storage.objects;
drop policy if exists "field_photos_auth_delete" on storage.objects;
create policy "field_photos_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'field-photos'
         and public.optiq_current_org() is not null
         and public.optiq_current_role() <> 'sub');

-- Рефлектограммы к протоколам сварки лежат здесь же, веткой journal/otdr/
-- (см. storageUploadOtdr в lib/supabase.ts). Схема не меняется: склад без
-- ограничения типов файлов, а .sor — такое же доказательство к акту, как
-- снимок. Имя каждый раз новое, без перезаписи: правила выше дают класть
-- и удалять, но не переписывать, и доказательство нельзя тихо подменить.

-- NEXT_PUBLIC_SUPABASE_URL=
-- NEXT_PUBLIC_SUPABASE_ANON_KEY=
-- NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH=1  (рекомендуется в проде)
