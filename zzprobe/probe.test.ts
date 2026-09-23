import { describe, it, expect } from 'vitest';
import {
  clusterPoints, scaleBar, arrowsAlong, progressSplit, locateOnRoute, lengthLabels, formatMeters,
} from '@/components/Construction/mapDecor';
import { findOverlaps, sampleRoute } from '@/components/Construction/overlaps';
import { routeLengthM } from '@/components/Construction/routeProgress';
import { sliceByDistance } from '@/components/Construction/routeSegments';
import { formatOne, formatLatLon, parseLatLon } from '@/components/Construction/coordFormat';
import { parseMapHash, buildMapHash } from '@/lib/mapLink';
import {
  nearestOnRoute, polygonAreaM2, circleCoords, measureLine, haversineM, perimeterM, formatArea,
} from '@/components/Construction/measureTool';
import { joinRoutes, splitRoute } from '@/components/Construction/routeEdit';

const mpp = (lat: number, zoom: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

describe('probe', () => {
  it('clusterPoints shear', () => {
    const z = 13;
    const m = mpp(53, z);
    const cellM = 46 * m;
    console.log('mpp', m, 'cellM', cellM);
    // два объекта на одной долготе, в 20 метрах друг от друга по широте
    const results: string[] = [];
    for (let k = 0; k < 40; k++) {
      const lat = 53 + k * 0.0001;
      const pts = [{ lat, lon: 69 }, { lat: lat + 0.00018, lon: 69 }]; // ~20 м
      const c = clusterPoints(pts, 46, m);
      if (c.length > 1) results.push(`lat=${lat.toFixed(4)} split`);
    }
    console.log('SPLIT PAIRS (20 m apart, cell ~530 m):', results.length, results.slice(0, 5));
  });

  it('scaleBar overflow', () => {
    for (const [mppv, maxPx] of [[0.005, 90], [0.01, 90], [0.09, 92], [0.02, 92]] as const) {
      const b = scaleBar(mppv, maxPx);
      console.log('mpp', mppv, 'maxPx', maxPx, '->', b);
    }
  });

  it('arrowsAlong coverage', () => {
    // длинная трасса 100 км, экран zoom 12 -> mpp ~ 24 м/пикс, everyM = 130*mpp ~ 3160 м
    const coords: [number, number][] = [];
    for (let i = 0; i <= 100; i++) coords.push([53, 69 + i * 0.015]);
    const total = routeLengthM(coords);
    const m = mpp(53, 12);
    const arrows = arrowsAlong(coords, { everyM: m * 130, max: 12 });
    console.log('total km', total / 1000, 'everyM', m * 130, 'arrows', arrows.length,
      'last arrow atM', arrows[arrows.length - 1]?.atM, 'covers km', (arrows[arrows.length - 1]?.atM ?? 0) / 1000);
  });

  it('formatOne rounding overflow', () => {
    const bad: string[] = [];
    for (let i = 0; i < 200000; i++) {
      const v = 52 + i / 200000;
      const s = formatOne(v, 'lat', 'dms');
      if (/′60,/.test(s) || /°60′/.test(s)) { bad.push(`${v} -> ${s}`); if (bad.length > 3) break; }
    }
    console.log('DMS overflow samples:', bad.slice(0, 4));
    const bad2: string[] = [];
    for (let i = 0; i < 200000; i++) {
      const v = 52 + i / 200000;
      const s = formatOne(v, 'lat', 'dm');
      if (/°60,/.test(s)) { bad2.push(`${v} -> ${s}`); if (bad2.length > 3) break; }
    }
    console.log('DM overflow samples:', bad2.slice(0, 4));
    console.log('specific:', formatOne(52.999999, 'lat', 'dm'), '|', formatOne(52.999999, 'lat', 'dms'));
  });

  it('parseMapHash malformed percent', () => {
    try {
      const v = parseMapHash('#14/52.0/69.0/100%');
      console.log('ok', v);
    } catch (e: any) {
      console.log('THROWS:', e.constructor.name, e.message);
    }
  });

  it('buildMapHash nonfinite', () => {
    console.log(buildMapHash({ lat: NaN, lon: 69, zoom: 14 }));
  });

  it('perf sliceByDistance / progressSplit', () => {
    const coords: [number, number][] = [];
    for (let i = 0; i < 2000; i++) coords.push([53 + i * 0.0002, 69 + i * 0.0003]);
    const t0 = Date.now();
    const s = progressSplit(coords, routeLengthM(coords) * 0.4);
    const t1 = Date.now();
    console.log('progressSplit on 2000 pts:', t1 - t0, 'ms; done pts', s.done.length, 'left pts', s.left.length);
  });

  it('perf sampleRoute / findOverlaps', () => {
    const mk = (dlat: number): [number, number][] => {
      const c: [number, number][] = [];
      for (let i = 0; i < 2000; i++) c.push([53 + dlat + i * 0.00005, 69 + i * 0.0005]);
      return c;
    };
    const a = mk(0);
    const t0 = Date.now();
    const pts = sampleRoute(a, 40);
    const t1 = Date.now();
    console.log('route len km', routeLengthM(a) / 1000, 'samples', pts.length, 'sampleRoute ms', t1 - t0);
  });

  it('findOverlaps exact duplicate', () => {
    const a: [number, number][] = [[53, 69], [53, 69.05]];
    const dup: [number, number][] = [[53, 69], [53, 69.05]];
    console.log('exact dup:', findOverlaps([{ id: 'a', name: 'A', coords: a }, { id: 'b', name: 'B', coords: dup }]));
    // та же линия, нарисованная в обратную сторону
    const rev: [number, number][] = [[53, 69.05], [53, 69]];
    console.log('reversed dup:', findOverlaps([{ id: 'a', name: 'A', coords: a }, { id: 'b', name: 'B', coords: rev }]));
    // длинный дубль
    const long1: [number, number][] = [[53, 69], [53, 69.5]];
    const long2: [number, number][] = [[53.00003, 69], [53.00003, 69.5]];
    const r = findOverlaps([{ id: 'a', name: 'A', coords: long1 }, { id: 'b', name: 'B', coords: long2 }]);
    console.log('long dup, real len m', routeLengthM(long1), '->', r);
  });

  it('findOverlaps north-south line', () => {
    // Линия строго на север длиной 5,5 км — дубль сдвинут на 3 м на восток
    const a: [number, number][] = [[53, 69], [53.05, 69]];
    const b: [number, number][] = [[53, 69.00005], [53.05, 69.00005]];
    console.log('N-S len', routeLengthM(a),
      findOverlaps([{ id: 'a', name: 'A', coords: a }, { id: 'b', name: 'B', coords: b }]));
  });

  it('degenerate inputs', () => {
    const same: [number, number][] = [[53, 69], [53, 69], [53, 69]];
    console.log('locateOnRoute degenerate', locateOnRoute(same, 10));
    console.log('progressSplit degenerate', progressSplit(same, 10));
    console.log('measureLine empty', measureLine([]));
    console.log('nearestOnRoute degenerate', nearestOnRoute({ lat: 53, lon: 69 }, same));
    console.log('lengthLabels degenerate', lengthLabels(same, { minMeters: 0 }));
    console.log('sliceByDistance degenerate', sliceByDistance(same, 0, 10));
    console.log('splitRoute degenerate', splitRoute(same, 5));
    console.log('joinRoutes degenerate', joinRoutes(same, same));
    console.log('polygonAreaM2 degenerate', polygonAreaM2(same));
    console.log('perimeter 2pt', perimeterM([[53, 69], [53, 69.1]]));
    console.log('circleCoords', circleCoords([53, 69], [53, 69]).length);
    console.log('formatMeters neg', formatMeters(-5), formatMeters(NaN));
    console.log('formatArea', JSON.stringify(formatArea(12345)));
  });

  it('polygon area sanity', () => {
    // прямоугольник 1 км x 2 км под Кокшетау
    const dLat = 1000 / 111320;
    const dLon = 2000 / (111320 * Math.cos((53 * Math.PI) / 180));
    const rect: [number, number][] = [[53, 69], [53 + dLat, 69], [53 + dLat, 69 + dLon], [53, 69 + dLon]];
    console.log('area m2 (expect ~2 000 000):', polygonAreaM2(rect));
    // контур, пересекающий сам себя? нет. Просто обратный обход:
    console.log('area reversed:', polygonAreaM2([...rect].reverse()));
  });

  it('coord roundtrip fuzz', () => {
    const bad: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const lat = 40 + Math.random() * 15;
      const lon = 46 + Math.random() * 40;
      for (const style of ['decimal', 'dm', 'dms', 'nav'] as const) {
        const s = formatLatLon({ lat, lon }, style);
        const back = parseLatLon(s);
        if (!back || Math.abs(back.lat - lat) > 0.001 || Math.abs(back.lon - lon) > 0.001) {
          bad.push(`${style} ${lat},${lon} -> ${s} -> ${JSON.stringify(back)}`);
        }
      }
      if (bad.length > 5) break;
    }
    console.log('ROUNDTRIP FAILS:', bad.length, bad.slice(0, 6));
  });

  it('parse odd inputs', () => {
    for (const s of [
      '52.091435 69.123456',
      '52,091435 69,123456',
      '52.09, 69.12',
      '69.123456, 52.091435',
      '43.2, 51.9',
      '51.2, 51.4',
      'широта 52.09 долгота 69.12',
      '52°05′29″ с.ш. 69°07′24″ в.д.',
      '52 05 29 N 69 07 24 E',
      'N52.09 E69.12',
      '52.09N 69.12E',
      '-33.916600, 18.416600',
      '52.09 69.12',
    ]) {
      console.log(JSON.stringify(s), '->', JSON.stringify(parseLatLon(s)));
    }
  });

  it('nearestOnRoute far segment projection', () => {
    // очень длинная трасса: проверяем, что atM не уезжает
    const coords: [number, number][] = [[53, 69], [53, 69.1], [53.1, 69.1]];
    const hit = nearestOnRoute({ lat: 53.1, lon: 69.1 }, coords)!;
    console.log('end snap', hit, 'total', routeLengthM(coords));
  });

  it('joinRoutes gap dedupe', () => {
    const A: [number, number][] = [[53, 69], [53, 69.05]];
    const B: [number, number][] = [[53, 69.05], [53, 69.1]];
    console.log(JSON.stringify(joinRoutes(A, B)));
    // Одинаковые линии
    console.log('same line join:', JSON.stringify(joinRoutes(A, [...A])));
  });
});
