import {
  LAY_METHODS, LAY_METHOD_LABEL,
  type AerialWorkEntry, type DailyWorkEntry,
} from '@/types/construction';
import { aerialIn, aerialMeters } from './aerialWork';

/**
 * Журнал таблицей для 1С и Google Таблиц.
 *
 * Бухгалтерия складывает колонки сама. Без подвеса её сумма метров не
 * сходилась ни с отчётом, ни с ведомостью, где подвес уже есть, —
 * поэтому записи подвеса идут теми же строками, со своей колонкой
 * «Подвес, м»: подземка и подвес в одной колонке не смешиваются.
 *
 * Новая колонка — последней: загрузку в 1С настраивают по номерам
 * колонок, и вставка в середину молча сдвинула бы «Примечание» в «Автора».
 */
export const JOURNAL_CSV_HEADERS = [
  'Дата', 'Область', 'Район', 'Участок', 'КАТО',
  'Подрядчик', 'Колонна', 'СМУ',
  ...LAY_METHODS.map((m) => LAY_METHOD_LABEL[m]),
  'ГНБ, м', 'Проколов', 'Задувка, м',
  'Примечание', 'Простой', 'Автор', 'Подвес, м',
];

export interface CsvFilter {
  from?: string;
  to?: string;
  contractor?: string;
}

export function journalCsvRows(
  ground: DailyWorkEntry[],
  aerial: AerialWorkEntry[],
  f: CsvFilter = {},
): { headers: string[]; rows: (string | number)[][] } {
  const g = ground
    .filter((e) => (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to)
      && (!f.contractor || e.contractor === f.contractor))
    .map((e) => ({
      date: e.date,
      row: [
        e.date, e.oblast, e.rayon ?? '', e.uchastok, e.kato,
        e.contractor ?? '', e.column ?? '', e.smu,
        ...LAY_METHODS.map((m) => e.byMethod[m] ?? 0),
        e.drillM ?? 0, e.drillCount ?? 0, e.blowingM ?? 0,
        e.note ?? '', e.downtime ?? '', e.author ?? '', 0,
      ] as (string | number)[],
    }));
  const a = aerialIn(aerial, f).map((e) => ({
    date: e.date,
    row: [
      e.date, e.oblast, e.rayon ?? '', e.uchastok, e.kato,
      e.contractor ?? '', e.column ?? '', e.smu,
      ...LAY_METHODS.map(() => 0),
      0, 0, 0,
      e.note ?? '', '', e.author ?? '', aerialMeters(e),
    ] as (string | number)[],
  }));
  // По дате: день подземки и день подвеса одного села рядом. Сортировка
  // устойчивая — порядок смен внутри дня остаётся журнальным.
  const rows = [...g, ...a]
    .sort((x, y) => (x.date || '').localeCompare(y.date || ''))
    .map((x) => x.row);
  return { headers: JOURNAL_CSV_HEADERS, rows };
}
