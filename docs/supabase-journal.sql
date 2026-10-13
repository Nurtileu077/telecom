-- OPTIQ: журнал стройки (Слой 2) — общая таблица для всех бригад.
--
-- Зачем: до этого журнал жил в localStorage, то есть у каждого свой.
-- Бригадир не видел, где стоит соседняя колонна, а отчётность не получала
-- дневные записи, пока их не выгрузят файлом.
--
-- Одна строка на организацию: весь журнал лежит документом в data.
-- Для дневных отчётов этого достаточно — объёмы небольшие, а слияние
-- версий делает клиент (components/Construction/journalSync.ts).
--
-- Порядок применения — как у остальных: Supabase → SQL Editor → выполнить.
-- Перед этим должны быть заданы NEXT_PUBLIC_OPTIQ_ORG_ID и user_metadata.org_id.

-- org_key — ключ строки: org_id текстом, либо 'default' для установки без
-- организаций. Отдельный ключ нужен потому, что org_id должен оставаться
-- nullable ради тех же политик «строка без org_id общая», а первичный ключ
-- null быть не может.
create table if not exists optiq_journal (
  org_key text primary key,
  org_id uuid,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists optiq_journal_updated_idx on optiq_journal (updated_at desc);

alter table optiq_journal enable row level security;

-- Видит и правит журнал только тот, у кого в токене тот же org_id.
-- Строки без org_id считаем общими: так работает и gpon_projects,
-- чтобы установка без организаций не оказалась запертой.

drop policy if exists "journal_select_org" on optiq_journal;
create policy "journal_select_org"
  on optiq_journal for select
  to authenticated
  using (
    org_id is null
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  );

drop policy if exists "journal_insert_org" on optiq_journal;
create policy "journal_insert_org"
  on optiq_journal for insert
  to authenticated
  with check (
    org_id is null
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  );

drop policy if exists "journal_update_org" on optiq_journal;
create policy "journal_update_org"
  on optiq_journal for update
  to authenticated
  using (
    org_id is null
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  )
  with check (
    org_id is null
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  );

-- Удаление журнала целиком не предусмотрено: записи убираются надгробиями
-- внутри документа, а не удалением строки. Политики delete нет намеренно.

-- Realtime (необязательно): Database → Replication → включить optiq_journal,
-- если нужно, чтобы сводка у отчётности обновлялась без нажатия «Синхронизировать».


-- ── Проекты стройки: строка на проект ───────────────────────────────────────
--
-- СНП и Гипертрасса — разные договоры с разными заказчиками, и журнал у
-- каждого свой (components/Construction/projects.ts). Схема для этого не
-- меняется: org_key и раньше был ключом строки, а не самой организацией.
--
--   «СНП»            → org_key = организация        (как до деления)
--   другой проект    → org_key = 'организация:проект'
--
-- «СНП» оставлен строкой организации нарочно: в неё же пишут устройства,
-- ещё не обновлённые до проектов, и все сходятся в одном журнале сёл, а
-- не заводят второй. org_id у всех строк проекта — та же организация, и
-- политики выше пускают к ним ровно так же.
--
-- Внутри data лежит отметка проекта: data->'project' = {id, name, ...}.
-- По ней другие устройства узнают, какие проекты уже заведены:
--
--     select org_key, data->'project' from optiq_journal;
--
-- Не сделано (п. 222): optiq_journal_mine() режет срез субподрядчику по
-- организации, а не по проекту. Пока проектов в облаке нет, это одна
-- строка; когда появятся, клиент субподрядчика берёт только «СНП» и
-- останавливает обмен, если сервер отдал несколько строк без отметки, —
-- чужой договор в своём журнале назад не разделить.
