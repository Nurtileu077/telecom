import { DuctMark } from '@/types/construction';

/**
 * Метки трубы в том виде, в каком их пишут в отчёте:
 *
 *   4003 — 0000
 *   4000 — 2490 м
 *
 * В Excel они живут одной ячейкой, поэтому список превращается в строку
 * «4003 — 0000; 4000 — 2490» и обратно. Разделитель принимаем любой из
 * встречающихся: тире, дефис, двоеточие.
 */

export function formatDuctMarks(marks?: DuctMark[]): string {
  if (!marks || marks.length === 0) return '';
  return marks.map((m) => `${m.coil} — ${m.meters}`).join('; ');
}

const MARK_RE = /([\w./-]+)\s*[—–\-:]\s*(\d+(?:[.,]\d+)?)/g;

export function parseDuctMarks(text: string): DuctMark[] {
  if (!text || typeof text !== 'string') return [];
  const out: DuctMark[] = [];
  MARK_RE.lastIndex = 0;
  for (let m = MARK_RE.exec(text); m; m = MARK_RE.exec(text)) {
    const coil = m[1].trim();
    const meters = parseFloat(m[2].replace(',', '.'));
    if (!coil || !Number.isFinite(meters)) continue;
    out.push({ coil, meters: Math.round(meters) });
  }
  return out;
}
