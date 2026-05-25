import type { Cable, District, ValidationIssue } from '@/types/network';
import { validateNetwork } from './MaterialCalc';
import { cablesForEntity } from './SnapConnect';

/** Проверки перед экспортом: базовая validateNetwork + топология. */
export function validateForExport(districts: District[], cables: Cable[]): ValidationIssue[] {
  const issues = [...validateNetwork(districts, cables)];

  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      const linked = cablesForEntity(cables, tb.id);
      if (linked.length === 0) {
        issues.push({
          type: 'warning',
          message: `Муфта ${tb.id}: нет кабелей (пустышка — протяните или поставьте на трассу)`,
          entityId: tb.id,
        });
      }
    }
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        const linked = cablesForEntity(cables, ork.id);
        if (linked.length === 0) {
          issues.push({
            type: 'warning',
            message: `ОРК ${ork.id}: не подключён кабелем`,
            entityId: ork.id,
          });
        }
      }
    }
  }

  for (const c of cables) {
    if (c.fromId.startsWith('pt-') || c.toId.startsWith('pt-')) {
      issues.push({
        type: 'warning',
        message: `Кабель ${c.id}: конец не привязан к узлу (${c.fromId} → ${c.toId})`,
        entityId: c.id,
      });
    }
    if (c.coords.length < 2) {
      issues.push({
        type: 'error',
        message: `Кабель ${c.id}: нет геометрии`,
        entityId: c.id,
      });
    }
  }

  return issues;
}

export function formatValidationSummary(issues: ValidationIssue[]): string {
  const err = issues.filter((i) => i.type === 'error').length;
  const warn = issues.filter((i) => i.type === 'warning').length;
  if (err === 0 && warn === 0) return 'Проблем не найдено.';
  return `${err ? `${err} ошибок` : ''}${err && warn ? ', ' : ''}${warn ? `${warn} предупреждений` : ''}`;
}
