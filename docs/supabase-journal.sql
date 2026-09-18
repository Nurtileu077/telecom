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
