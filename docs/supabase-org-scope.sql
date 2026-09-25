-- OPTIQ: организация переезжает из user_metadata в app_metadata.
--
-- Зачем. Политики доступа сверяли организацию строки с
-- `auth.jwt() -> 'user_metadata' ->> 'org_id'`. Беда в том, что
-- user_metadata пользователь правит себе сам — одним запросом из
-- браузера:
--
--     supabase.auth.updateUser({ data: { org_id: 'чужая-организация' } })
--
-- После этого он читает и пишет чужой журнал: чужие объёмы, чужие
-- расценки, чужие расчёты с подрядчиками. То есть разграничение по
-- организациям было декорацией, а не защитой. Ровно об этом и говорил
-- встроенный проверяльщик Supabase, отмечая это ошибкой, а не
-- замечанием.
--
-- app_metadata правит только служебный ключ — то есть тот, кто ведёт
-- журнал в конторе. Туда организация и переезжает.
--
-- Применение: Supabase → SQL Editor → выполнить. Выполнено 2026-09-25
-- как миграция org_scope_from_app_metadata.

-- 1. Переносим то, что уже проставлено, чтобы никого не выкинуть.
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                         || jsonb_build_object('org_id', raw_user_meta_data->>'org_id')
 where raw_user_meta_data ? 'org_id'
   and coalesce(raw_app_meta_data->>'org_id', '') = '';

-- Новому человеку организацию выдают отсюда же, служебным ключом:
--
--     update auth.users
--        set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb)
--                              || '{"org_id":"…"}'::jsonb
--      where email = 'кто@например.kz';
--
-- Без этого он войдёт, но не увидит ничего — и это правильно: доступ
-- выдаёт тот, кто ведёт журнал, а не тот, кто завёл себе почту.

-- 2. Организация вошедшего — одним местом на все политики.
create or replace function public.optiq_current_org()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'org_id', '')
$$;

comment on function public.optiq_current_org() is
  'Организация вошедшего, из app_metadata. user_metadata сюда не годится: его правит сам пользователь.';

-- 3. Новая строка сама получает организацию своего автора.
--
-- Без этого разграничение зависело бы от того, не забыли ли проставить
-- org_id на клиенте. А забыть его — значит записать строку без
-- организации, и прежние политики открывали такую строку всем вошедшим.
create or replace function public.optiq_stamp_org()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_id is null then
    new.org_id := public.optiq_current_org()::uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists optiq_journal_stamp_org_tr on public.optiq_journal;
create trigger optiq_journal_stamp_org_tr
  before insert or update on public.optiq_journal
  for each row execute function public.optiq_stamp_org();

drop trigger if exists gpon_projects_stamp_org_tr on public.gpon_projects;
create trigger gpon_projects_stamp_org_tr
  before insert or update on public.gpon_projects
  for each row execute function public.optiq_stamp_org();

-- 4. Политики журнала: только своя организация.
--
-- Оговорку «или org_id пустой» убираем. Она открывала строку без
-- организации всем вошедшим — а именно такие строки и писал клиент, пока
-- не задан NEXT_PUBLIC_OPTIQ_ORG_ID. То есть в настройке по умолчанию
-- разграничение не работало вовсе.
drop policy if exists journal_select_org on public.optiq_journal;
drop policy if exists journal_insert_org on public.optiq_journal;
drop policy if exists journal_update_org on public.optiq_journal;

create policy journal_select_org on public.optiq_journal
  for select to authenticated
  using (org_id::text = public.optiq_current_org());

create policy journal_insert_org on public.optiq_journal
  for insert to authenticated
  with check (coalesce(org_id::text, public.optiq_current_org()) = public.optiq_current_org());

create policy journal_update_org on public.optiq_journal
  for update to authenticated
  using (org_id::text = public.optiq_current_org())
  with check (coalesce(org_id::text, public.optiq_current_org()) = public.optiq_current_org());

-- 5. То же для проектов генератора.
drop policy if exists projects_select_org on public.gpon_projects;
drop policy if exists projects_insert_org on public.gpon_projects;
drop policy if exists projects_update_org on public.gpon_projects;
drop policy if exists projects_delete_org on public.gpon_projects;

create policy projects_select_org on public.gpon_projects
  for select to authenticated
  using (org_id::text = public.optiq_current_org());

create policy projects_insert_org on public.gpon_projects
  for insert to authenticated
  with check (coalesce(org_id::text, public.optiq_current_org()) = public.optiq_current_org());

create policy projects_update_org on public.gpon_projects
  for update to authenticated
  using (org_id::text = public.optiq_current_org())
  with check (coalesce(org_id::text, public.optiq_current_org()) = public.optiq_current_org());

create policy projects_delete_org on public.gpon_projects
  for delete to authenticated
  using (org_id::text = public.optiq_current_org());

-- 6. Служебные функции невошедшему не нужны: политик под anon нет.
revoke execute on function public.gpon_projects_snapshot() from anon;
revoke execute on function public.gpon_projects_stamp_editor() from anon;
revoke execute on function public.optiq_owns_project(text) from anon;
revoke execute on function public.optiq_is_shared_with_me(text) from anon;
revoke execute on function public.optiq_current_org() from anon;

-- Проверка, которой это принималось:
--
--   свой org_id          → видит свои строки
--   чужой org_id         → видит только свои, наших не видит
--   подделан user_metadata → не видит ничего          ← дыра закрыта
--   без организации      → не видит и не пишет ничего
