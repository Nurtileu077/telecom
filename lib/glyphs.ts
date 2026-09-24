/**
 * Имена значков.
 *
 * Справочники — муфты, колонны, роли, допуски — хранят имя значка
 * строкой, а не сам рисунок: данные не должны знать о том, чем их
 * рисуют. Одно и то же имя годится и для экрана, и для печати, и для
 * выгрузки, где никаких рисунков нет вовсе.
 *
 * Эмодзи остаются запасным вариантом: там, где значок ещё не подобран,
 * лучше старая наклейка, чем пустое место в ряду.
 */

export const GLYPH_NAMES = [
  'mufta', 'stolb', 'endpoint', 'kks',
  'mkt', 'gnb', 'zaduvka', 'podves', 'svarka',
  'office', 'boss', 'sub',
  'permit', 'clearance', 'contact', 'claim', 'task',
] as const;

export type GlyphName = (typeof GLYPH_NAMES)[number];

/** Чем рисовали раньше — на случай, если значок не подобран. */
export const GLYPH_FALLBACK: Record<GlyphName, string> = {
  mufta: '🔗',
  stolb: '🪵',
  endpoint: '🏫',
  kks: '⬛',
  mkt: '🚜',
  gnb: '🛠',
  zaduvka: '💨',
  podves: '🗼',
  svarka: '🔥',
  office: '📋',
  boss: '📈',
  sub: '🤝',
  permit: '📄',
  clearance: '🎓',
  contact: '📞',
  claim: '⚖',
  task: '✔',
};

export function isGlyphName(v: string): v is GlyphName {
  return (GLYPH_NAMES as readonly string[]).includes(v);
}
