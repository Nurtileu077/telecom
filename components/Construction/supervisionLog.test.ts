import { describe, it, expect } from 'vitest';
import {
  supervisionRows, supervisionDocHtml, supervisionFileName, worksText, addressText,
} from './supervisionLog';
import type { DailyWorkEntry, Deviation } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-09-17', smu: '',
    contractor: 'TERRA TECH',
    oblast: 'Акмолинская область', rayon: 'Зерендинский',
    uchastok: 'Еленовка', kato: '191',
    byMethod: {}, materials: {}, createdAt: now, updatedAt: now, ...over,
  };
}

describe('тетрадь технадзора', () => {
  it('строка работ собирается из операций с глубиной', () => {
    const t = worksText(g({
      operations: { proporka: 6000, lay_mkt: 4100 },
      materials: { 'Лента': 4100 },
    }), 1.2);
    expect(t).toContain('Пропорка тяжёлой техникой на глубину 1,2 м — 6\u00a0000 м');
    expect(t).toContain('Прокладка МКТ на глубину 1,2 м — 4\u00a0100 м');
    expect(t).toContain('Прокладка сигнальной ленты — 4\u00a0100 м');
  });

  it('без подробной части берёт способы прокладки', () => {
    const t = worksText(g({ byMethod: { 'кабелеукладчик': 4200 } }), 1.2);
    expect(t).toContain('Кабелеукладчиком на глубину 1,2 м — 4\u00a0200 м');
  });

  it('глубина фактическая там, где было отклонение', () => {
    const dev: Deviation = {
      id: 'd1', kind: 'depth', date: '2026-09-17',
      oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
      lengthM: 50, designDepthM: 1.2, actualDepthM: 0.5, reason: 'скала', author: 'Ербол',
      createdAt: now, updatedAt: now,
    };
    const rows = supervisionRows({
      entries: [g({ byMethod: { 'кабелеукладчик': 100 } })],
      deviations: [dev],
    });
    expect(rows[0].works).toContain('0,5 м');
  });

  it('адрес включает метки трубы, если их снимали', () => {
    const a = addressText(g({ ductMarks: [{ coil: '4003', meters: 0 }] }));
    expect(a).toContain('Еленовка');
    expect(a).toContain('Зерендинский район');
    expect(a).toContain('метки 4003 — 0');
  });

  it('пустые дни в тетрадь не попадают', () => {
    const rows = supervisionRows({ entries: [g({}), g({ byMethod: { 'бар': 300 } })] });
    expect(rows).toHaveLength(1);
  });

  it('день с простоем попадает, даже если метров нет', () => {
    const rows = supervisionRows({ entries: [g({ downtime: 'Ждали согласование' })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe('Ждали согласование');
  });

  it('строки идут по датам', () => {
    const rows = supervisionRows({
      entries: [
        g({ date: '2026-09-17', byMethod: { 'бар': 1 } }),
        g({ date: '2026-09-15', byMethod: { 'бар': 1 } }),
      ],
    });
    expect(rows.map((r) => r.date)).toEqual(['2026-09-15', '2026-09-17']);
  });

  it('документ несёт форму, шапку и графы подписей', () => {
    const html = supervisionDocHtml({
      entries: [g({ byMethod: { 'кабелеукладчик': 4200 }, tomorrow: '08:00' })],
      contractor: 'ТОО «СК Фаворит Инжиниринг»',
      oblast: 'Акмолинская область', rayon: 'Зерендинский', uchastok: 'Еленовка',
      from: '2026-09-17', to: '2026-09-17',
    });
    expect(html).toContain('Форма КТ/33.07.25');
    expect(html).toContain('Приложение Б');
    expect(html).toContain('Адрес участка (ПК-ПК)');
    expect(html).toContain('Подпись технадзора');
    expect(html).toContain('Время начала работ назавтра');
    expect(html).toContain('ТОО «СК Фаворит Инжиниринг»');
    expect(html).toContain('08:00');
  });

  it('за пустой период документ не притворяется заполненным', () => {
    const html = supervisionDocHtml({ entries: [] });
    expect(html).toContain('За период записей нет');
  });

  it('имя файла говорит, что внутри', () => {
    expect(supervisionFileName('Еленовка', '2026-09-01', '2026-09-17'))
      .toBe('Тетрадь технадзора Еленовка 2026-09-01—2026-09-17.doc');
  });
});
