-- OPTIQ: bucket для полевых фото (Supabase Dashboard → SQL или Storage UI)

-- 1. Создать bucket "field-photos" (public read для просмотра в приложении)
insert into storage.buckets (id, name, public)
values ('field-photos', 'field-photos', true)
on conflict (id) do update set public = true;

-- 2. Политики (anon key — загрузка/удаление для авторизованных проектов; упростите под RLS)
create policy "field_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'field-photos');

create policy "field_photos_anon_insert"
  on storage.objects for insert
  with check (bucket_id = 'field-photos');

create policy "field_photos_anon_delete"
  on storage.objects for delete
  using (bucket_id = 'field-photos');

-- Переменные окружения в Next.js:
-- NEXT_PUBLIC_SUPABASE_URL=
-- NEXT_PUBLIC_SUPABASE_ANON_KEY=
