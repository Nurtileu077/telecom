import type { Project, District, ORK, TransitBox } from '@/types/network';

export type MergeStrategy =
  | 'server_all'
  | 'local_all'
  | 'local_network_server_field'
  | 'server_network_local_field';

function cloneDistricts(d: District[]): District[] {
  return JSON.parse(JSON.stringify(d));
}

function applyFieldToTb(local: TransitBox, server: TransitBox): TransitBox {
  return {
    ...local,
    fieldChecklist: server.fieldChecklist ?? local.fieldChecklist,
    fieldPhotos: server.fieldPhotos ?? local.fieldPhotos,
  };
}

function applyFieldToOrk(local: ORK, server: ORK): ORK {
  return {
    ...local,
    fieldChecklist: server.fieldChecklist ?? local.fieldChecklist,
    fieldPhotos: server.fieldPhotos ?? local.fieldPhotos,
  };
}

/** Слить полевые данные (чеклист, фото) с сервера в локальную топологию. */
export function mergeFieldDataIntoDistricts(local: District[], server: District[]): District[] {
  const serverTb = new Map<string, TransitBox>();
  const serverOrk = new Map<string, ORK>();
  for (const d of server) {
    for (const tb of d.olt.transitBoxes) {
      serverTb.set(tb.id, tb);
      for (const ork of tb.orks) serverOrk.set(ork.id, ork);
    }
  }

  return cloneDistricts(local).map((d) => ({
    ...d,
    olt: {
      ...d.olt,
      transitBoxes: d.olt.transitBoxes.map((tb) => {
        const st = serverTb.get(tb.id);
        const mergedTb = st ? applyFieldToTb(tb, st) : tb;
        return {
          ...mergedTb,
          orks: mergedTb.orks.map((ork) => {
            const so = serverOrk.get(ork.id);
            return so ? applyFieldToOrk(ork, so) : ork;
          }),
        };
      }),
    },
  }));
}

export function applyMergeStrategy(local: Project, server: Project, strategy: MergeStrategy): Project {
  switch (strategy) {
    case 'server_all':
      return { ...server, id: local.id, name: local.name };
    case 'local_all':
      return { ...local, updatedAt: new Date().toISOString() };
    case 'local_network_server_field':
      return {
        ...local,
        districts: mergeFieldDataIntoDistricts(local.districts, server.districts),
        auditLog: [...(local.auditLog ?? []), {
          id: `aud-merge-${Date.now()}`,
          at: new Date().toISOString(),
          action: 'Слияние',
          detail: 'Локальная сеть + поле с сервера',
        }],
        updatedAt: new Date().toISOString(),
      };
    case 'server_network_local_field':
      return {
        ...server,
        id: local.id,
        name: local.name,
        districts: mergeFieldDataIntoDistricts(server.districts, local.districts),
        auditLog: [...(server.auditLog ?? []), {
          id: `aud-merge-${Date.now()}`,
          at: new Date().toISOString(),
          action: 'Слияние',
          detail: 'Серверная сеть + локальное поле',
        }],
        updatedAt: new Date().toISOString(),
      };
  }
}
