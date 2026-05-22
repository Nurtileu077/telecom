-- OPTIQ: RLS для gpon_projects (мульти-команда / организация)
-- Перед применением: включите Auth, задайте user_metadata.org_id (uuid) при регистрации.
-- В приложении: NEXT_PUBLIC_OPTIQ_ORG_ID и NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH=1

alter table gpon_projects add column if not exists org_id uuid;
create index if not exists gpon_projects_org_idx on gpon_projects (org_id);

alter table gpon_projects enable row level security;

drop policy if exists "projects_select_org" on gpon_projects;
create policy "projects_select_org"
  on gpon_projects for select
  to authenticated
  using (
    org_id is null
    or org_id::text = coalesce(auth.jwt() ->> 'org_id', '')
  );

drop policy if exists "projects_insert_org" on gpon_projects;
create policy "projects_insert_org"
  on gpon_projects for insert
  to authenticated
  with check (
    org_id is null
    or org_id::text = coalesce(auth.jwt() ->> 'org_id', '')
  );

drop policy if exists "projects_update_org" on gpon_projects;
create policy "projects_update_org"
  on gpon_projects for update
  to authenticated
  using (
    org_id is null
    or org_id::text = coalesce(auth.jwt() ->> 'org_id', '')
  )
  with check (
    org_id is null
    or org_id::text = coalesce(auth.jwt() ->> 'org_id', '')
  );

drop policy if exists "projects_delete_org" on gpon_projects;
create policy "projects_delete_org"
  on gpon_projects for delete
  to authenticated
  using (
    org_id is null
    or org_id::text = coalesce(auth.jwt() ->> 'org_id', '')
  );

-- Realtime: Dashboard → Database → Replication → включить gpon_projects (для presence отдельный канал optiq-presence:*)
