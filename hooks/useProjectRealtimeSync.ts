'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export interface RemoteProjectUpdate {
  updatedAt: string;
  name: string;
}

/**
 * Подписка на изменения строки gpon_projects в Supabase Realtime.
 * Когда коллега сохраняет проект, локальная копия подтягивается с сервера.
 */
export function useProjectRealtimeSync(
  projectId: string | null,
  enabled: boolean,
  localUpdatedAt: string | null,
  onRemoteUpdate: (info: RemoteProjectUpdate) => void | Promise<void>,
) {
  const applyingRef = useRef(false);
  const lastRemoteRef = useRef<string | null>(null);
  const onRemoteRef = useRef(onRemoteUpdate);
  onRemoteRef.current = onRemoteUpdate;

  useEffect(() => {
    if (!enabled || !supabase || !projectId) return;

    const channel = supabase
      .channel(`optiq-project:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'gpon_projects',
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.new as { updated_at?: string; name?: string };
          const updatedAt = row?.updated_at;
          if (!updatedAt || applyingRef.current) return;
          if (localUpdatedAt && updatedAt === localUpdatedAt) return;
          if (lastRemoteRef.current === updatedAt) return;
          lastRemoteRef.current = updatedAt;
          void onRemoteRef.current({
            updatedAt,
            name: (row?.name as string) || '',
          });
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [enabled, projectId, localUpdatedAt]);
}
