import { createClient } from '@supabase/supabase-js';
import type { Project, CatalogItem } from '@/types/network';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = url && key ? createClient(url, key) : null;

export interface ProjectRow {
  id: string;
  name: string;
  data: Project;
  created_at: string;
  updated_at: string;
}

export async function dbListProjects(): Promise<ProjectRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('gpon_projects')
    .select('id, name, created_at, updated_at, data')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

export async function dbSaveProject(project: Project): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('gpon_projects')
    .upsert({
      id: project.id,
      name: project.name,
      data: project,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function dbDeleteProject(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('gpon_projects').delete().eq('id', id);
  if (error) throw error;
}

export async function dbLoadProject(id: string): Promise<Project | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('gpon_projects')
    .select('data')
    .eq('id', id)
    .single();
  if (error) return null;
  return (data as { data: Project }).data;
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
