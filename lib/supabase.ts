import { createClient } from '@supabase/supabase-js';
import type { Project } from '@/types/network';

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
