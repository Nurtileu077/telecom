import {
  DailyWorkEntry, DrillLogEntry, Crew, SiteObject, SnpProgress, PlanRoute,
  WorkRate, Deviation,
} from '@/types/construction';
import { emptyJournal, type JournalState } from './journalStore';

/**
 * Показательный журнал.
 *
 * Пустая система ничего о себе не рассказывает: человек открывает её,
 * видит «записей нет» и закрывает. Показать, как она выглядит в работе,
 * можно только на данных — и брать их из чужого реального объекта
 * нельзя.
 *
 * Поэтому свои: Зерендинский район, три села, две колонны, месяц смен.
 * Числа правдоподобные, но выдуманные, и это сказано прямо — иначе
 * кто-нибудь однажды сошлётся на них в отчёте.
 */

/**
 * Тот же ряд чисел при каждом запуске.
 *
 * Случайные данные, меняющиеся при каждом открытии, невозможно ни
 * обсудить, ни показать второй раз.
 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const OBLAST = 'Акмолинская область';
const RAYON = 'Зерендинский район';

const SNPS = [
  { kato: '116243100', snp: 'Серафимовка', lat: 52.9, lon: 69.15 },
  { kato: '116243200', snp: 'Кусеп', lat: 52.97, lon: 69.31 },
  { kato: '116243300', snp: 'Айдабол', lat: 53.05, lon: 69.02 },
];

const CONTRACTORS = ['Дозер', 'TERRA TECH'];

function iso(day: number, from: Date): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

/** Показательный журнал за месяц. */
export function demoJournal(now = new Date()): JournalState {
  const rnd = seeded(20260725);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 30);
  const nowIso = now.toISOString();

  const ground: DailyWorkEntry[] = [];
  const drills: DrillLogEntry[] = [];

  for (let day = 0; day < 30; day++) {
    const date = iso(day, start);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    // Воскресенье чаще всего выходной — так и в жизни.
    if (weekday === 0 && rnd() < 0.8) continue;

    SNPS.forEach((snp, i) => {
      if (rnd() < 0.35) return;
      const contractor = CONTRACTORS[i % CONTRACTORS.length];
      const column = `${i + 1}-колонна`;
      const base = 600 + Math.round(rnd() * 900);
      const rain = rnd() < 0.12;

      ground.push({
        kind: 'ground',
        id: `demo-g-${day}-${i}`,
        date,
        smu: `СМУ-${(i % 3) + 1}`,
        contractor,
        column,
        oblast: OBLAST,
        rayon: RAYON,
        uchastok: `Зеренда — ${snp.snp}`,
        kato: snp.kato,
        tech: 'МКТ',
        byMethod: rain
          ? {}
          : rnd() < 0.7
            ? { 'кабелеукладчик': base }
            : { 'бар': Math.round(base * 0.6), 'вручную': Math.round(base * 0.1) },
        materials: rain ? {} : { 'МКТ': Math.round(base * 1.02), 'Лента': base },
        equipment: { 'Кабелеукладчик': 1, 'Самосвал': 1 },
        downtime: rain ? 'дождь, грунт не держит стенку' : undefined,
        note: rain ? undefined : rnd() < 0.15 ? 'скальный участок, шли медленнее' : undefined,
        author: 'Показательные данные',
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      if (rnd() < 0.2) {
        drills.push({
          kind: 'drill',
          id: `demo-d-${day}-${i}`,
          drillKind: 'ГНБ',
          date,
          smu: `СМУ-${(i % 3) + 1}`,
          contractor,
          oblast: OBLAST,
          rayon: RAYON,
          uchastok: `Зеренда — ${snp.snp}`,
          kato: snp.kato,
          meters: 40 + Math.round(rnd() * 50),
          count: 1,
          points: [
            { lat: snp.lat + rnd() * 0.01, lon: snp.lon + rnd() * 0.01 },
            { lat: snp.lat + rnd() * 0.01, lon: snp.lon + rnd() * 0.01 },
          ],
          crossings: ['автодорога'],
          author: 'Показательные данные',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    });
  }

  const crews: Crew[] = SNPS.map((snp, i) => ({
    id: `demo-c-${i}`,
    kind: 'mkt',
    name: `${i + 1}-колонна`,
    contractor: CONTRACTORS[i % CONTRACTORS.length],
    status: 'working',
    lat: snp.lat,
    lon: snp.lon,
    oblast: OBLAST,
    rayon: RAYON,
    uchastok: `Зеренда — ${snp.snp}`,
    members: [
      { name: `Мастер участка ${i + 1}`, role: 'Мастер' },
      { name: `Машинист ${i + 1}`, role: 'Машинист' },
      { name: `Разнорабочий ${i + 1}`, role: 'Разнорабочий' },
    ],
    equipment: { 'Кабелеукладчик': 1, 'Самосвал': 1 },
    updatedAt: nowIso,
  }));

  const objects: SiteObject[] = SNPS.flatMap((snp, i) => ([
    {
      id: `demo-o-kks-${i}`,
      kind: 'kks' as const,
      name: `ККС ${i + 1}`,
      lat: snp.lat - 0.004,
      lon: snp.lon - 0.004,
      oblast: OBLAST,
      rayon: RAYON,
      uchastok: `Зеренда — ${snp.snp}`,
      kato: snp.kato,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: `demo-o-end-${i}`,
      kind: 'endpoint' as const,
      name: `Школа с. ${snp.snp}`,
      endpointKind: 'Школа',
      lat: snp.lat,
      lon: snp.lon,
      oblast: OBLAST,
      rayon: RAYON,
      uchastok: `Зеренда — ${snp.snp}`,
      kato: snp.kato,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ]));

  const planRoutes: PlanRoute[] = SNPS.map((snp, i) => ({
    id: `demo-r-${i}`,
    name: `Зеренда — ${snp.snp}`,
    uchastok: `Зеренда — ${snp.snp}`,
    coords: [
      [52.95, 69.1],
      [snp.lat, snp.lon],
    ] as [number, number][],
    lengthM: 8000 + i * 3000,
    source: 'показательные данные',
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const progress: SnpProgress[] = SNPS.map((snp, i) => ({
    kato: snp.kato,
    snp: snp.snp,
    oblast: OBLAST,
    rayon: RAYON,
    stages: i === 0
      ? { mkt: { status: 'done' }, gnb: { status: 'done' }, zaduvka: { status: 'in_progress' } }
      : i === 1
        ? { mkt: { status: 'in_progress' } }
        : {},
    updatedAt: nowIso,
  }));

  const rates: WorkRate[] = [
    {
      id: 'demo-rate-1', work: 'кабелеукладчик', price: 450, unit: 'м',
      from: iso(0, start), updatedAt: nowIso,
    },
    {
      id: 'demo-rate-2', work: 'бар', price: 700, unit: 'м',
      from: iso(0, start), updatedAt: nowIso,
    },
    {
      id: 'demo-rate-3', work: 'drillM', price: 6500, unit: 'м',
      from: iso(0, start), updatedAt: nowIso,
    },
  ];

  const deviations: Deviation[] = [{
    id: 'demo-dev-1',
    kind: 'depth',
    date: iso(12, start),
    oblast: OBLAST,
    rayon: RAYON,
    uchastok: `Зеренда — ${SNPS[0].snp}`,
    kato: SNPS[0].kato,
    contractor: CONTRACTORS[0],
    lengthM: 180,
    designDepthM: 1.2,
    actualDepthM: 0.9,
    reason: 'скальный грунт, глубже не берёт',
    author: 'Показательные данные',
    createdAt: nowIso,
    updatedAt: nowIso,
  }];

  return {
    ...emptyJournal(),
    ground,
    drills,
    crews,
    objects,
    planRoutes,
    progress,
    rates,
    deviations,
    updatedAt: nowIso,
  };
}

/**
 * Показательный режим.
 *
 * Данные лежат под своим ключом: настоящий журнал не трогаем ни на
 * секунду, а выйти из показа можно в любой момент и ничего не потерять.
 */
export const DEMO_KEY = 'optiq-demo-mode';

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; }
}

export function setDemoMode(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(DEMO_KEY, '1');
    else window.localStorage.removeItem(DEMO_KEY);
  } catch { /* приватный режим */ }
}

/** Сколько чего в показательном журнале — для описания кнопки. */
export function demoSummary(j: JournalState): string {
  return `${j.ground.length} смен, ${j.crews.length} колонны, `
    + `${j.planRoutes.length} трассы, ${j.objects.length} объектов`;
}
