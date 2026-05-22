-- OPTIQ: RLS для gpon_projects (мульти-команда / организация)
-- Добавьте колонку org_id uuid и привяжите к auth.users через JWT claim или таблицу members.

-- alter table gpon_projects add column if not exists org_id uuid;
-- create index if not exists gpon_projects_org_idx on gpon_projects (org_id);

-- alter table gpon_projects enable row level security;

-- create policy "projects_select_org"
--   on gpon_projects for select
--   using (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- create policy "projects_insert_org"
--   on gpon_projects for insert
--   with check (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- create policy "projects_update_org"
--   on gpon_projects for update
--   using (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- Конфликт версий: колонка updated_at уже есть — клиент сравнивает перед upsert.
