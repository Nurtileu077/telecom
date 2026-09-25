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


-- ── Кто когда заходил ───────────────────────────────────────────────────────
--
-- Записи ведёт сам Supabase, в auth.audit_log_entries. Берём их оттуда, а
-- не пишем с клиента: запись, сделанную браузером, браузер и подделает, а
-- смысл журнала входов ровно в том, чтобы ей верить.
--
-- Список короткий по своей природе: Supabase чистит старое сам. Пустой
-- список — нормальный ответ, а не поломка.
create or replace function public.optiq_login_log(limit_rows int default 200)
returns table (
  email text,
  событие text,
  когда timestamptz,
  откуда text
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text,
         case a.payload ->> 'action'
           when 'login'          then 'вход'
           when 'logout'         then 'выход'
           when 'token_refreshed' then 'продление'
           when 'user_recovery_requested' then 'сброс пароля'
           when 'user_signedup'  then 'регистрация'
           else coalesce(a.payload ->> 'action', 'неизвестно')
         end,
         a.created_at,
         coalesce(a.ip_address, '—')
    from auth.audit_log_entries a
    join auth.users u
      on u.id = nullif(a.payload ->> 'actor_id', '')::uuid
   where public.optiq_current_org() is not null
     and u.raw_app_meta_data ->> 'org_id' = public.optiq_current_org()
     -- Продление токена случается каждый час у каждого: в списке оно
     -- вытеснит всё остальное и смотреть его станет незачем.
     and coalesce(a.payload ->> 'action', '') <> 'token_refreshed'
   order by a.created_at desc
   limit greatest(1, least(coalesce(limit_rows, 200), 1000));
$$;

revoke execute on function public.optiq_login_log(int) from anon, public;
grant execute on function public.optiq_login_log(int) to authenticated;

-- Проверено: свой видит свою запись, чужая организация — ни одной,
-- вошедший без организации — ни одной.


-- ── Субподрядчик видит только своё ──────────────────────────────────────────
--
-- До сих пор отбор по подрядчику делал экран: журнал приходил целиком, а
-- фильтровался в браузере. Для удобства хватало, для доступа — нет:
-- аккаунт субподрядчика читал через API весь журнал, включая чужие
-- объёмы, чужие расценки и расчёты с другими подрядчиками.
--
-- Журнал лежит одним документом на организацию, и порезать его
-- построчными политиками нельзя. Поэтому субподрядчику закрыт сам стол,
-- а вместо него дана функция, отдающая документ уже без чужого.
--
-- Писать субподрядчик не может, и это не ограничение, а их порядок
-- работы: смены закрывает генподрядчик, субподрядчик смотрит, что ему
-- насчитали. Совместная запись в один документ потребовала бы слияния
-- на сервере — а это ровно то место, где ошибка стоит денег.
--
-- Кого считать субподрядчиком, задаётся тем же служебным ключом:
--
--     update auth.users
--        set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb)
--            || '{"org_id":"…","role":"sub","contractor":"TERRA TECH"}'::jsonb
--      where email = 'кто@например.kz';
--
-- Полный текст функций — в миграциях subcontractor_read_only_slice и
-- subcontractor_slice_hide_requisites.
--
-- Что видит субподрядчик:
--   смены, подвес, проколы, колонны, платежи, отклонения, аварии,
--   заявки, план  — только свои, по полю contractor;
--   расценки      — свои и общие: по общей ему и платят;
--   трассы, объекты, контуры, реестр сёл — общие: без них не понять, где
--                   он работает;
--   цены закупки, поля актов, журнал изменений, корзина, надгробия — нет;
--   реквизиты сторон — нет: это договор генподрядчика с заказчиком.
--
-- Запись без подрядчика ему не отдаётся: чья она — неизвестно, и
-- записать её себе он не вправе.
--
-- Проверено на живом журнале: субподрядчик не читает стол напрямую,
-- видит одну свою смену из трёх и свой платёж из двух, не видит цен,
-- реквизитов и полей актов, трассы видит; второй субподрядчик видит
-- своё и только своё; свой, не субподрядчик, читает журнал как раньше;
-- субподрядчик без указанного подрядчика не видит ничего и записать
-- ничего не может.


-- ── Документы, которые отдают ссылкой ───────────────────────────────────────
--
-- Акт уходит в почту вложением, потом в нём находят ошибку, отправляют
-- второй — и у заказчика их два, а какой верный, видно только по дате
-- письма. Ссылка решает это: она одна, и открывается по ней всегда то,
-- что лежит сейчас.
--
-- Склад отдельный от снимков и непубличный. Снимки лежат открыто
-- осознанно — их смотрят с телефона по прямой ссылке. С актом так
-- нельзя: в нём объёмы, суммы и реквизиты сторон.
--
-- Заказчику аккаунт не нужен: ему уходит подписанная ссылка со сроком.
-- Срок нужен потому, что письма пересылают, а папки «Загрузки» живут
-- годами: ссылка, действующая вечно, однажды утечёт вместе с перепиской.
--
-- Полный текст — в миграции documents_bucket. Права: класть и заменять
-- может только своя организация и только в свою папку (первый кусок
-- пути — org_id); субподрядчику отправка закрыта — это дело
-- генподрядчика, и его реквизиты стоят в документах.
