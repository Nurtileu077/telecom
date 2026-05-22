import { createClient } from '@supabase/supabase-js';
import type { Project, CatalogItem } from '@/types/network';
import { getDefaultOrgId } from '@/lib/orgId';
import { assertSupabaseAccess } from '@/lib/supabaseAccess';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = url && key
  ? createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
  : null;

export interface ProjectRow {
  id: string;
  name: string;
  data: Project;
  org_id?: string | null;
  created_at: string;
  updated_at: string;
}

export async function dbListProjects(): Promise<ProjectRow[]> {
  if (!supabase) return [];
  await assertSupabaseAccess();
  const { data, error } = await supabase
    .from('gpon_projects')
    .select('id, name, created_at, updated_at, data')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

export async function dbSaveProject(project: Project): Promise<void> {
  if (!supabase) return;
  await assertSupabaseAccess();
  const orgId = project.orgId ?? getDefaultOrgId();
  const row: Record<string, unknown> = {
    id: project.id,
    name: project.name,
    data: project,
    updated_at: new Date().toISOString(),
  };
  if (project.createdAt) row.created_at = project.createdAt;
  if (orgId) row.org_id = orgId;
  const { error } = await supabase.from('gpon_projects').upsert(row);
  if (error) throw error;
}

export async function dbDeleteProject(id: string): Promise<void> {
  if (!supabase) return;
  await assertSupabaseAccess();
  const { error } = await supabase.from('gpon_projects').delete().eq('id', id);
  if (error) throw error;
}

export async function dbLoadProject(id: string): Promise<Project | null> {
  const row = await dbLoadProjectRow(id);
  return row?.data ?? null;
}

export async function dbLoadProjectRow(id: string): Promise<ProjectRow | null> {
  if (!supabase) return null;
  await assertSupabaseAccess();
  const { data, error } = await supabase
    .from('gpon_projects')
    .select('id, name, org_id, created_at, updated_at, data')
    .eq('id', id)
    .single();
  if (error) return null;
  const row = data as ProjectRow;
  if (row.org_id && row.data && !row.data.orgId) {
    row.data = { ...row.data, orgId: row.org_id };
  }
  return row;
}

export async function dbFetchProjectRevision(id: string): Promise<{ updated_at: string; name: string } | null> {
  if (!supabase) return null;
  await assertSupabaseAccess();
  const { data, error } = await supabase
    .from('gpon_projects')
    .select('updated_at, name')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return { updated_at: data.updated_at as string, name: data.name as string };
}

// ── Equipment catalog ─────────────────────────────────────────────────────────
export async function dbListCatalog(): Promise<CatalogItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('gpon_catalog')
    .select('*')
    .order('category', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, category: r.category, article: r.article, name: r.name,
    unit: r.unit, price: Number(r.price), currency: r.currency,
    vendor: r.vendor, link: r.link, notes: r.notes,
  }));
}

export async function dbUpsertCatalog(item: CatalogItem): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('gpon_catalog').upsert({
    id: item.id, category: item.category, article: item.article, name: item.name,
    unit: item.unit, price: item.price, currency: item.currency,
    vendor: item.vendor, link: item.link ?? '', notes: item.notes ?? '',
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function dbDeleteCatalog(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('gpon_catalog').delete().eq('id', id);
  if (error) throw error;
}

// ── Field photos (Storage bucket: field-photos) ─────────────────────────────
const FIELD_PHOTOS_BUCKET = 'field-photos';

export async function storageUploadFieldPhoto(
  projectId: string,
  entityKind: 'ork' | 'tb',
  entityId: string,
  blob: Blob,
): Promise<{ url: string; storagePath: string }> {
  if (!supabase) throw new Error('Supabase не настроен');
  await assertSupabaseAccess();
  const safeId = entityId.replace(/[^\w.-]/g, '_');
  const storagePath = `${projectId}/${entityKind}/${safeId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(FIELD_PHOTOS_BUCKET)
    .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(FIELD_PHOTOS_BUCKET).getPublicUrl(storagePath);
  return { url: data.publicUrl, storagePath };
}

export async function storageDeleteFieldPhoto(storagePath: string): Promise<void> {
  if (!supabase || !storagePath) return;
  const { error } = await supabase.storage.from(FIELD_PHOTOS_BUCKET).remove([storagePath]);
  if (error) throw error;
}
