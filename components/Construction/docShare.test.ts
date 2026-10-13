import { describe, it, expect } from 'vitest';
import { periodDoc, sectionDoc, ruDay, type DocScope } from './docShare';
import { docPath } from '@/lib/docLink';

const ORG = 'a3f8c2e1-9b4d-4f1a-8c6e-2d7b9e4f1a03';
const SNP: DocScope = { projectId: 'snp', projectName: 'СНП' };
const path = (d: { address: Parameters<typeof docPath>[1] }) => docPath(ORG, d.address, 'docx');

describe('ссылка на отчёт за период', () => {
  it('отчёт по Акмолинской и по Костанайской за сентябрь — разные ссылки', () => {
    // Ссылку на Акмолинскую уже отправили заказчику: Костанайская, собранная
    // за те же даты, не должна открыться по ней.
    const akm = periodDoc({ ...SNP, oblast: 'Акмолинская область' }, '2026-09-01', '2026-09-30');
    const kst = periodDoc({ ...SNP, oblast: 'Костанайская область' }, '2026-09-01', '2026-09-30');
    expect(path(akm)).not.toBe(path(kst));
  });

  it('отчёт по одной области и по всем — разные ссылки', () => {
    const one = periodDoc({ ...SNP, oblast: 'Акмолинская область' }, '2026-09-01', '2026-09-30');
    const all = periodDoc(SNP, '2026-09-01', '2026-09-30');
    expect(path(one)).not.toBe(path(all));
  });

  it('отчёт для TERRA TECH не ложится на общий', () => {
    const terra = periodDoc({ ...SNP, contractor: 'TERRA TECH' }, '2026-09-01', '2026-09-30');
    const all = periodDoc(SNP, '2026-09-01', '2026-09-30');
    expect(path(terra)).not.toBe(path(all));
  });

  it('отчёт Гипертрассы за те же даты не ложится на отчёт сёл', () => {
    const snp = periodDoc(SNP, '2026-09-01', '2026-09-30');
    const hyper = periodDoc({ projectId: 'p1k2', projectName: 'Гипертрасса' }, '2026-09-01', '2026-09-30');
    expect(path(snp)).not.toBe(path(hyper));
  });

  it('переименовали проект — отданная ссылка открывается по-прежнему', () => {
    const before = periodDoc({ projectId: 'p1k2', projectName: 'Магистраль' }, '2026-09-01', '2026-09-30');
    const after = periodDoc({ projectId: 'p1k2', projectName: 'Гипертрасса' }, '2026-09-01', '2026-09-30');
    expect(path(before)).toBe(path(after));
  });

  it('тот же отчёт, собранный заново, ложится туда же — заказчику не перезапрашивать', () => {
    const a = periodDoc({ ...SNP, oblast: 'Акмолинская область' }, '2026-09-01', '2026-09-30');
    const b = periodDoc({ ...SNP, oblast: 'Акмолинская область' }, '2026-09-01', '2026-09-30');
    expect(path(a)).toBe(path(b));
  });

  it('другие даты — другая ссылка', () => {
    expect(path(periodDoc(SNP, '2026-09-01', '2026-09-30')))
      .not.toBe(path(periodDoc(SNP, '2026-10-01', '2026-10-31')));
  });

  it('заголовок называет даты, область, подрядчика и проект', () => {
    const d = periodDoc(
      { ...SNP, oblast: 'Акмолинская область', contractor: 'TERRA TECH' },
      '2026-09-01', '2026-09-30',
    );
    expect(d.title).toBe(
      'Отчёт за период 01.09.2026 — 30.09.2026 · Акмолинская область · TERRA TECH · проект СНП',
    );
  });

  it('без области и подрядчика заголовок их не выдумывает', () => {
    expect(periodDoc(SNP, '2026-09-01', '2026-09-30').title)
      .toBe('Отчёт за период 01.09.2026 — 30.09.2026 · проект СНП');
  });

  it('за всё время не пишет пустой период «за период  — »', () => {
    expect(periodDoc(SNP, '', '2026-09-30').title).toBe('Отчёт за период по 30.09.2026 · проект СНП');
    expect(periodDoc(SNP, '', '').title).toBe('Отчёт за всё время · проект СНП');
    expect(periodDoc(SNP, '2026-09-30', '2026-09-30').title).toBe('Отчёт за 30.09.2026 · проект СНП');
  });

  it('дату не сдвигает на сутки: «2026-09-01» остаётся первым сентября', () => {
    expect(ruDay('2026-09-01')).toBe('01.09.2026');
  });
});

describe('ссылка на акт по участку', () => {
  const kind = 'акт скрытых работ';
  const label = 'Акт скрытых работ';

  it('акт одного села — одна ссылка, при какой бы области его ни собрали', () => {
    // Область села — из его смен, а не из фильтра: иначе тот же акт,
    // собранный с фильтром и без, ушёл бы заказчику двумя ссылками.
    const plain = sectionDoc(SNP, kind, label, 'Зеренда', ['Акмолинская область']);
    const filtered = sectionDoc({ ...SNP, oblast: 'Акмолинская область' }, kind, label, 'Зеренда', ['Акмолинская область']);
    expect(path(plain)).toBe(path(filtered));
  });

  it('два села «Аксу» в разных областях — разные ссылки', () => {
    const akm = sectionDoc(SNP, kind, label, 'Аксу', ['Акмолинская область']);
    const alm = sectionDoc(SNP, kind, label, 'Аксу', ['Алматинская область']);
    expect(path(akm)).not.toBe(path(alm));
  });

  it('область смен без отметки и повторы не меняют ссылку', () => {
    const a = sectionDoc(SNP, kind, label, 'Аксу', ['Акмолинская область', undefined, 'Акмолинская область']);
    const b = sectionDoc(SNP, kind, label, 'Аксу', ['Акмолинская область']);
    expect(path(a)).toBe(path(b));
  });

  it('акт того же участка в другом проекте — в папке своего проекта', () => {
    const snp = sectionDoc(SNP, kind, label, 'Аксу', ['Акмолинская область']);
    const hyper = sectionDoc({ projectId: 'p1k2', projectName: 'Гипертрасса' }, kind, label, 'Аксу', ['Акмолинская область']);
    expect(path(snp)).not.toBe(path(hyper));
    expect(path(hyper)).toContain('/p1k2/');
  });

  it('заголовок называет участок, его область и проект', () => {
    expect(sectionDoc(SNP, kind, label, 'Аксу', ['Акмолинская область']).title)
      .toBe('Акт скрытых работ, Аксу · Акмолинская область · проект СНП');
  });

  it('у участка без области в сменах заголовок её не придумывает', () => {
    expect(sectionDoc(SNP, kind, label, 'Аксу', [undefined, '']).title)
      .toBe('Акт скрытых работ, Аксу · проект СНП');
  });
});
