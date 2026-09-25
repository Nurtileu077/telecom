import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Перевод не должен попадать в документы.
 *
 * Разметку экрана переводить надо, а HTML, который собирают строками в
 * тех же файлах, — нельзя: документ уедет заказчику со словом
 * {t('Участок')} в шапке таблицы, и заметят это на подписании.
 *
 * Однажды так и случилось: автозамена прошлась по всему файлу и задела
 * генератор сводного реестра. Здесь записано, чтобы не повторилось.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Куски файла внутри строковых литералов — именно там живёт HTML. */
function insideStrings(src: string): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) { out.push(src.slice(start, i)); quote = null; }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      start = i + 1;
    }
  }
  return out;
}

const FILES = [...walk('components'), ...walk('lib'), ...walk('app')]
  .filter((f) => !f.includes('.test.'));

describe('перевод не протекает в документы', () => {
  it('ни в одной строке-литерале нет вызова переводчика', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes("t('")) continue;
      for (const chunk of insideStrings(src)) {
        // Разметка документа узнаётся по тегу рядом.
        if (/\{t\(/.test(chunk) && /<[a-z]/i.test(chunk)) {
          bad.push(`${file}: ${chunk.slice(0, 70)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('шапки таблиц в документах остались словами, а не вызовами', () => {
    const docs = FILES.filter((f) => /actDocument|fieldDocs|volumeDocs|periodReports|asBuilt|DocsView/.test(f));
    expect(docs.length).toBeGreaterThan(4);
    for (const file of docs) {
      const src = readFileSync(file, 'utf8');
      for (const chunk of insideStrings(src)) {
        expect(chunk).not.toContain('{t(');
      }
    }
  });
});
