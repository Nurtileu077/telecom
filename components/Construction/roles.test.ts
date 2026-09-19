import { describe, it, expect } from 'vitest';
import {
  JOURNAL_ROLES, JOURNAL_ROLE_LIST, JOURNAL_ROLE_LABEL, normalizeRole,
} from '@/types/construction';

describe('роли в журнале', () => {
  it('старое «поле» становится МКТ, а не сбрасывает выбор', () => {
    expect(normalizeRole('field')).toBe('mkt');
    expect(normalizeRole('office')).toBe('office');
    expect(normalizeRole('gnb')).toBe('gnb');
  });

  it('мусор и пустота дают полевую роль, а не падение', () => {
    expect(normalizeRole(null)).toBe('mkt');
    expect(normalizeRole(undefined)).toBe('mkt');
    expect(normalizeRole('кто-то')).toBe('mkt');
  });

  it('у каждой роли есть свой стартовый экран, и он входит в её вкладки', () => {
    for (const r of JOURNAL_ROLE_LIST) {
      const spec = JOURNAL_ROLES[r];
      expect(spec.views).toContain(spec.home);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });

  it('подтверждать исправления может только отчётность', () => {
    const approvers = JOURNAL_ROLE_LIST.filter((r) => JOURNAL_ROLES[r].canApprove);
    expect(approvers).toEqual(['office']);
  });

  it('у полевых ролей нет закрытия участка — это не их работа', () => {
    for (const r of ['mkt', 'gnb', 'zaduvka', 'podves', 'svarka'] as const) {
      expect(JOURNAL_ROLES[r].views).not.toContain('closing');
      expect(JOURNAL_ROLES[r].views).not.toContain('corrections');
    }
  });

  it('ГНБ открывается на проколах, руководство — на сводке для руководства', () => {
    expect(JOURNAL_ROLES.gnb.home).toBe('drills');
    expect(JOURNAL_ROLES.boss.home).toBe('management');
    expect(JOURNAL_ROLES.svarka.home).toBe('passport');
  });

  it('подписи ролей собираются из тех же карточек', () => {
    expect(JOURNAL_ROLE_LABEL.gnb).toBe('ГНБ');
    expect(Object.keys(JOURNAL_ROLE_LABEL)).toEqual(JOURNAL_ROLE_LIST);
  });
});
