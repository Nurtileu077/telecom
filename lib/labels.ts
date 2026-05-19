/** Единые подписи объектов сети в UI и KMZ (не технические id вроде Sheet1-12). */

export const ENTITY_LABELS = {
  olt: 'Узел связи',
  // Единый лейбл для всех муфт в UI и KMZ — пользователь не должен
  // различать «транзитная МТОК / обжимная / сварная».  Детали (L1,
  // тип МТОК, стык, разветвление) идут в tooltip / description.
  mufta: 'Муфта',
  // Сохранены для обратной совместимости с кодом, ссылающимся на них.
  // Значение умышленно одно и то же — рендерится одинаково.
  transitMufta: 'Муфта',
  spliceMufta: 'Муфта',
  orksp: 'ОРКСП',
  subscriber: 'Камера',
  ontBox: 'Бокс (ОНТ)',
} as const;

export function isGenericSheetName(s: string): boolean {
  return /^sheet\d*[-_]?\d*$/i.test(s.trim()) || /^sheet\d+$/i.test(s.trim());
}

/** Убрать color:#… из описаний KML / форм. */
export function sanitizeDescription(raw: string | undefined): string {
  if (!raw) return '';
  let s = raw
    .replace(/color\s*:\s*#[0-9a-fA-F]{3,8}\s*;?/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/** Длина в метрах из названия «… 334 м» или «334м». */
export function parseLengthMetersFromText(text: string): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:м|m)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Метраж из ExtendedData (разные GIS). */
export function parseLengthFromExtData(ext?: Record<string, string>): number | null {
  if (!ext) return null;
  const keys = [
    'метраж', 'Метраж', 'Метраж (м.)', 'Метраж (м)', 'метры', 'Метры',
    'lengthM', 'length', 'Length', 'gps', 'GPS метраж', 'GPS метраж (м.)',
    'Общий метраж', 'Общий метраж (м.)', 'gpsLength', 'totalLength',
  ];
  for (const k of keys) {
    for (const [ek, ev] of Object.entries(ext)) {
      if (ek.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase() === ek.toLowerCase()) {
        const n = parseFloat(String(ev).replace(/[^\d.,]/g, '').replace(',', '.'));
        if (Number.isFinite(n) && n > 0) return Math.round(n);
      }
    }
  }
  return null;
}
