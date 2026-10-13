import type { DocAddress } from '@/lib/docLink';

/**
 * Что отдают ссылкой и под каким адресом.
 *
 * Ссылку на отчёт за сентябрь по Акмолинской отправили заказчику, а
 * потом за те же даты собрали Костанайскую — или отчёт для TERRA TECH, —
 * и он лёг в тот же файл: адрес строился из одного заголовка «Отчёт за
 * период 01.09 — 30.09». По старой ссылке заказчик открывал чужое, а
 * после деления на проекты — ещё и чужой договор.
 *
 * Здесь собирается всё, чем сужен документ на экране, — проект, область,
 * подрядчик, — и из этого же строятся и адрес в складе, и заголовок
 * письма: заказчик должен видеть в письме то, что откроется по ссылке.
 */

export interface DocScope {
  /** Номер проекта стройки: по нему папка в складе. */
  projectId: string;
  /** Название проекта — для заголовка письма. */
  projectName?: string;
  /** Область, которой сужен журнал; пусто — все области. */
  oblast?: string;
  /** Подрядчик, чьи смены одни вошли; пусто — все. */
  contractor?: string;
}

export interface SharedDoc {
  address: DocAddress;
  /** Заголовок письма и панели ссылки. */
  title: string;
}

const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Дата для заголовка — как в самом отчёте, «01.09.2026».
 *
 * Без `Date`: строка «2026-09-01», разобранная как время, в Алматы
 * показывается тем же днём, а в UTC — предыдущим.
 */
export function ruDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : clean(iso);
}

function periodWords(from: string, to: string): string {
  const f = ruDay(from);
  const t = ruDay(to);
  if (f && t) return f === t ? `за ${f}` : `за период ${f} — ${t}`;
  if (t) return `за период по ${t}`;
  if (f) return `за период с ${f}`;
  return 'за всё время';
}

/** Хвост заголовка: чем сужено и в каком проекте. */
function tail(scope: DocScope, place: string[]): string {
  const bits = [...place, clean(scope.contractor)].filter(Boolean);
  const project = clean(scope.projectName);
  if (project) bits.push(`проект ${project}`);
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

/**
 * Отчёт за период.
 *
 * Содержимое выбирают даты, область и подрядчик — они и входят в адрес.
 * Тот же набор — та же ссылка: исправленный отчёт заменяет прежний, и
 * заказчику не нужно перезапрашивать ссылку.
 */
export function periodDoc(
  scope: DocScope,
  from: string,
  to: string,
  kind = 'отчёт за период',
  label = 'Отчёт',
): SharedDoc {
  const oblast = clean(scope.oblast);
  return {
    address: {
      project: scope.projectId,
      kind,
      parts: [`${from ?? ''}..${to ?? ''}`, oblast, clean(scope.contractor)],
    },
    title: `${label} ${periodWords(from, to)}${tail(scope, oblast ? [oblast] : [])}`,
  };
}

/**
 * Документ по участку — акт скрытых работ и подобные.
 *
 * Участок называют по имени, а сёл «Аксу» в Казахстане десятки, и в
 * журнале одного проекта их может оказаться два в разных областях.
 * Поэтому в адрес идёт не выбранная на экране область, а области самих
 * смен участка: акт одного и того же села остаётся на одной ссылке, с
 * какой бы областью его ни собрали, а одноимённое село другой области
 * получает свою.
 */
export function sectionDoc(
  scope: DocScope,
  kind: string,
  label: string,
  section: string,
  oblasts: (string | undefined)[],
): SharedDoc {
  const seen = new Map<string, string>();
  for (const o of oblasts) {
    const name = clean(o);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) seen.set(key, name);
  }
  const places = [...seen.values()].sort((a, b) => a.localeCompare(b, 'ru'));
  const name = clean(section);
  return {
    address: {
      project: scope.projectId,
      kind,
      parts: [name, places.join(', '), clean(scope.contractor)],
    },
    title: `${label}, ${name || 'участок не назван'}${tail(scope, places.length ? [places.join(', ')] : [])}`,
  };
}
