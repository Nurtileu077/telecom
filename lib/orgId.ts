/** Идентификатор организации для RLS в Supabase (опционально). */
export function getDefaultOrgId(): string | undefined {
  const v = process.env.NEXT_PUBLIC_OPTIQ_ORG_ID?.trim();
  return v || undefined;
}
