import { describe, it, expect } from 'vitest';
import { GLYPH_NAMES, GLYPH_FALLBACK, isGlyphName } from './glyphs';
import {
  SITE_OBJECT_SPECS, CREW_KINDS, JOURNAL_ROLES,
} from '@/types/construction';
import { RECORD_KINDS } from '@/components/Construction/siteRecords';

describe('имена значков', () => {
  it('у каждого есть запасной эмодзи', () => {
    for (const n of GLYPH_NAMES) {
      expect(GLYPH_FALLBACK[n]).toBeTruthy();
    }
  });

  it('имена не повторяются', () => {
    expect(new Set(GLYPH_NAMES).size).toBe(GLYPH_NAMES.length);
  });

  it('узнаёт своё имя и не признаёт чужое', () => {
    expect(isGlyphName('mufta')).toBe(true);
    expect(isGlyphName('трактор')).toBe(false);
  });
});

/**
 * Значок в справочнике — это имя, а не рисунок. Если справочник назовёт
 * имя, которого нет в наборе, на экране появится вопросительный знак, и
 * заметят это не сразу.
 */
describe('справочники называют существующие значки', () => {
  it('объекты на трассе', () => {
    for (const spec of Object.values(SITE_OBJECT_SPECS)) {
      expect(isGlyphName(spec.icon)).toBe(true);
    }
  });

  it('виды работ колонн', () => {
    for (const spec of Object.values(CREW_KINDS)) {
      expect(isGlyphName(spec.icon)).toBe(true);
    }
  });

  it('роли в журнале', () => {
    for (const spec of Object.values(JOURNAL_ROLES)) {
      expect(isGlyphName(spec.icon)).toBe(true);
    }
  });

  it('допуски, контакты, претензии', () => {
    for (const spec of Object.values(RECORD_KINDS)) {
      expect(isGlyphName(spec.icon)).toBe(true);
    }
  });
});
