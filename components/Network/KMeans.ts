export interface Point {
  lat: number;
  lon: number;
  id: string;
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function centroid(points: Point[]): { lat: number; lon: number } {
  if (points.length === 0) return { lat: 0, lon: 0 };
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  return { lat, lon };
}

// Seeded RNG so subsequent builds with the same input produce the same
// clustering.  Was Math.random() — adding 1 subscriber re-shuffled everything
// and produced a totally different OLT/TB/ORK layout, which made cables look
// like spaghetti after each minor edit.  mulberry32 is small, fast and good
// enough for clustering tie-breaks.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashPoints(points: Point[]): number {
  // FNV-1a over coords — independent of input order so [A,B] and [B,A]
  // produce the same seed.  Order-independent is the right thing for kmeans:
  // input order shouldn't change clustering results.
  let h = 2166136261 >>> 0;
  const sorted = [...points].sort((a, b) => (a.lat - b.lat) || (a.lon - b.lon));
  for (const p of sorted) {
    const lat = Math.round(p.lat * 1e6);
    const lon = Math.round(p.lon * 1e6);
    h = Math.imul(h ^ lat, 16777619);
    h = Math.imul(h ^ lon, 16777619);
  }
  return h >>> 0;
}

export function kmeans(
  points: Point[],
  k: number,
  iterations = 30,
): { centers: { lat: number; lon: number }[]; clusters: Point[][] } {
  if (points.length === 0) return { centers: [], clusters: [] };
  k = Math.min(k, points.length);
  if (k <= 1) return { centers: [centroid(points)], clusters: [points] };

  const rand = mulberry32(hashPoints(points) + k);

  // Initialize centers with k-means++ style — seeded so the same input
  // always yields the same initial centers.
  const centers: { lat: number; lon: number }[] = [];
  // Deterministic "shuffle" via Fisher-Yates with seeded RNG.
  const shuffled = [...points];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  centers.push({ lat: shuffled[0].lat, lon: shuffled[0].lon });

  for (let i = 1; i < k; i++) {
    const dists = shuffled.map((p) => {
      const minD = Math.min(...centers.map((c) => haversineM(p.lat, p.lon, c.lat, c.lon)));
      return minD * minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let idx = 0;
    for (let j = 0; j < dists.length; j++) {
      r -= dists[j];
      if (r <= 0) { idx = j; break; }
    }
    centers.push({ lat: shuffled[idx].lat, lon: shuffled[idx].lon });
  }

  let clusters: Point[][] = Array.from({ length: k }, () => []);

  for (let iter = 0; iter < iterations; iter++) {
    clusters = Array.from({ length: k }, () => []);
    for (const p of points) {
      let minD = Infinity;
      let minI = 0;
      for (let i = 0; i < centers.length; i++) {
        const d = haversineM(p.lat, p.lon, centers[i].lat, centers[i].lon);
        if (d < minD) { minD = d; minI = i; }
      }
      clusters[minI].push(p);
    }
    let changed = false;
    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;
      const nc = centroid(clusters[i]);
      if (Math.abs(nc.lat - centers[i].lat) > 1e-8 || Math.abs(nc.lon - centers[i].lon) > 1e-8) {
        centers[i] = nc;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Reassign empty clusters
  const nonEmpty = clusters.filter((c) => c.length > 0);
  const emptyCount = k - nonEmpty.length;
  if (emptyCount > 0) {
    return kmeans(points, nonEmpty.length, iterations);
  }

  return { centers, clusters };
}

/**
 * Делит k-means кластеры так, чтобы в каждом не больше maxSize точек
 * (для ОРКСП: макс. 8 камер на сплиттер 1:8).
 */
export function splitClustersByMaxSize(
  clusters: Point[][],
  maxSize: number,
): Point[][] {
  if (maxSize < 1) return clusters;
  const out: Point[][] = [];
  const queue: Point[][] = [...clusters];

  while (queue.length > 0) {
    const cluster = queue.shift()!;
    if (cluster.length <= maxSize) {
      if (cluster.length > 0) out.push(cluster);
      continue;
    }
    const subK = Math.min(cluster.length, Math.ceil(cluster.length / maxSize));
    const { clusters: parts } = kmeans(cluster, subK);
    for (const part of parts) {
      if (part.length === 0) continue;
      if (part.length > maxSize) queue.push(part);
      else out.push(part);
    }
  }

  return out;
}

/** Кластеризация абонентов под ОРКСП: не больше maxPerOrk в группе, до maxOrks групп. */
export function clusterForOrkGroups(
  subs: Point[],
  maxPerOrk: number,
  maxOrks: number,
): Point[][] {
  if (subs.length === 0) return [];
  const k = Math.min(maxOrks, Math.max(1, Math.ceil(subs.length / maxPerOrk)));
  const { clusters } = kmeans(subs, k);
  let groups = splitClustersByMaxSize(clusters, maxPerOrk);
  if (groups.length <= maxOrks) return groups;

  // Нужно больше ОРК, чем слотов L1×1:8 на муфте — увеличиваем k и пересобираем.
  const k2 = Math.min(subs.length, Math.max(k + 1, groups.length));
  const { clusters: c2 } = kmeans(subs, k2);
  groups = splitClustersByMaxSize(c2, maxPerOrk);
  return groups;
}
