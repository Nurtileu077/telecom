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
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  );

drop policy if exists "projects_insert_org" on gpon_projects;
create policy "projects_insert_org"
  on gpon_projects for insert
  to authenticated
  with check (
    org_id is null
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  );

drop policy if exists "projects_update_org" on gpon_projects;
create policy "projects_update_org"
  on gpon_projects for update
  to authenticated
  using (
    org_id is null
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  )
  with check (
    org_id is null
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  );

drop policy if exists "projects_delete_org" on gpon_projects;
create policy "projects_delete_org"
  on gpon_projects for delete
  to authenticated
  using (
    org_id is null
    or org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', '')
  );

-- Realtime: Dashboard → Database → Replication → включить gpon_projects (для presence отдельный канал optiq-presence:*)

-- ──────────────────────────────────────────────────────────────────────────
-- Шеринг проекта по email (в дополнение к org_id). Доступ выдаётся конкретному
-- email; получатель видит/редактирует проект, войдя под своим аккаунтом.
-- Управлять доступами может только владелец (по org_id).
-- Применено миграцией project_email_sharing.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.gpon_project_shares (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.gpon_projects(id) on delete cascade,
  email text not null,
  role text not null default 'editor',
  invited_by uuid,
  created_at timestamptz not null default now(),
  unique (project_id, email)
);
create index if not exists gpon_project_shares_email_idx on public.gpon_project_shares (lower(email));
create index if not exists gpon_project_shares_project_idx on public.gpon_project_shares (project_id);

-- SECURITY DEFINER, чтобы внутренние select обходили RLS соседней таблицы и не
-- было рекурсии политик (projects ↔ shares).
create or replace function public.optiq_is_shared_with_me(pid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gpon_project_shares s
    where s.project_id = pid and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.optiq_owns_project(pid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gpon_projects p
    where p.id = pid
      and (p.org_id is null or p.org_id::text = coalesce(auth.jwt() -> 'user_metadata' ->> 'org_id', ''))
  );
$$;

drop policy if exists "projects_select_shared" on public.gpon_projects;
create policy "projects_select_shared" on public.gpon_projects for select to authenticated
  using (public.optiq_is_shared_with_me(id));

drop policy if exists "projects_update_shared" on public.gpon_projects;
create policy "projects_update_shared" on public.gpon_projects for update to authenticated
  using (public.optiq_is_shared_with_me(id)) with check (public.optiq_is_shared_with_me(id));

alter table public.gpon_project_shares enable row level security;

drop policy if exists "shares_select" on public.gpon_project_shares;
create policy "shares_select" on public.gpon_project_shares for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.optiq_owns_project(project_id));

drop policy if exists "shares_insert" on public.gpon_project_shares;
create policy "shares_insert" on public.gpon_project_shares for insert to authenticated
  with check (public.optiq_owns_project(project_id));

drop policy if exists "shares_delete" on public.gpon_project_shares;
create policy "shares_delete" on public.gpon_project_shares for delete to authenticated
  using (public.optiq_owns_project(project_id));
