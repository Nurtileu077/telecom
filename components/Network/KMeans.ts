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

export function kmeans(
  points: Point[],
  k: number,
  iterations = 30
): { centers: { lat: number; lon: number }[]; clusters: Point[][] } {
  if (points.length === 0) return { centers: [], clusters: [] };
  k = Math.min(k, points.length);
  if (k <= 1) return { centers: [centroid(points)], clusters: [points] };

  // Initialize centers with k-means++ style
  const centers: { lat: number; lon: number }[] = [];
  const shuffled = [...points].sort(() => Math.random() - 0.5);
  centers.push({ lat: shuffled[0].lat, lon: shuffled[0].lon });

  for (let i = 1; i < k; i++) {
    const dists = shuffled.map((p) => {
      const minD = Math.min(...centers.map((c) => haversineM(p.lat, p.lon, c.lat, c.lon)));
      return minD * minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let idx = 0;
    for (let j = 0; j < dists.length; j++) {
      rand -= dists[j];
      if (rand <= 0) { idx = j; break; }
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
