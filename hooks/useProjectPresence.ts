'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { colorForUserId } from '@/lib/presenceColors';

export interface PresenceCursor {
  userId: string;
  name: string;
  color: string;
  lat: number;
  lon: number;
}

type PresencePayload = {
  name: string;
  lat: number;
  lon: number;
  ts: number;
};

function peersFromState(
  state: Record<string, PresencePayload[]>,
  selfKey: string | null,
): PresenceCursor[] {
  const out: PresenceCursor[] = [];
  for (const [key, entries] of Object.entries(state)) {
    if (selfKey && key === selfKey) continue;
    const last = entries[entries.length - 1];
    if (!last || typeof last.lat !== 'number') continue;
    out.push({
      userId: key,
      name: last.name || key.slice(0, 8),
      color: colorForUserId(key),
      lat: last.lat,
      lon: last.lon,
    });
  }
  return out;
}

export function useProjectPresence(
  projectId: string | null,
  self: { key: string; name: string } | null,
  enabled: boolean,
) {
  const [peers, setPeers] = useState<PresenceCursor[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const selfKeyRef = useRef<string | null>(null);

  const publishCursor = useCallback((lat: number, lon: number) => {
    const ch = channelRef.current;
    if (!ch || !self) return;
    ch.track({
      name: self.name,
      lat,
      lon,
      ts: Date.now(),
    } as PresencePayload);
  }, [self]);

  useEffect(() => {
    if (!enabled || !supabase || !projectId || !self) {
      setPeers([]);
      setOnlineCount(0);
      return;
    }

    selfKeyRef.current = self.key;
    const channel = supabase.channel(`optiq-presence:${projectId}`, {
      config: { presence: { key: self.key } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, PresencePayload[]>;
      const allKeys = Object.keys(state);
      setOnlineCount(allKeys.length);
      setPeers(peersFromState(state, self.key));
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          name: self.name,
          lat: 0,
          lon: 0,
          ts: Date.now(),
        } as PresencePayload);
      }
    });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
      selfKeyRef.current = null;
      setPeers([]);
      setOnlineCount(0);
    };
  }, [enabled, projectId, self?.key, self?.name]);

  return { peers, onlineCount, publishCursor };
}
