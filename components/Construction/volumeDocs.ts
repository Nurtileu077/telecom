import {
  DailyWorkEntry, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
  MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT,
} from '@/types/construction';
import { esc, ACT_DOC_CSS, fmtDate } from './actDocument';
import { entryMeters } from './entriesTable';

/**
 * Ведомость объёмов и то, что из неё вырастает.
 *
 * Объёмы за период собирают вручную: открывают журнал, складывают метры
 * по способам, переносят в таблицу, потом ту же таблицу пересчитывают
 * под КС-2 и под смету. Три раза одни и те же числа — и каждый раз
 * возможность ошибиться.
 *
 * Считаем один раз, а показываем в трёх видах: своя ведомость, форма
 * заказчика и стоимость по расценкам.
 */

export interface VolumeRow {
  /** Способ прокладки или отдельный вид работ. */
  key: string;
  label: string;
  unit: 'м' | 'шт';
  quantity: number;
}

export interface VolumeSheet {
  from: string;
  to: string;
  rows: VolumeRow[];
  totalM: number;
  /** По каким участкам собрано. */
  sections: string[];
  shifts: number;
}

export interface VolumeFilter {
  from?: string;
  to?: string;
  contractor?: string;
  uchastok?: string;
}

function inFilter(e: DailyWorkEntry, f: VolumeFilter): boolean {
  if (f.from && (e.date || '') < f.from) return false;
  if (f.to && (e.date || '') > f.to) return false;
  if (f.contractor && (e.contractor || '') !== f.contractor) return false;
  if (f.uchastok && (e.uchastok || '') !== f.uchastok) return false;
  return true;
}

/**
 * Ведомость за период.
 *
 * Пустые строки не показываем: ведомость, где половина позиций нулевая,
 * читается хуже короткой. Чего не делали — того в ведомости нет.
 */
export function volumeSheet(rows: DailyWorkEntry[], filter: VolumeFilter = {}): VolumeSheet {
  const list = rows.filter((e) => inFilter(e, filter));

  const byMethod = new Map<LayMethod, number>();
  const materials = new Map<MaterialKind, number>();
  let drillM = 0;
  let drillCount = 0;
  let blowingM = 0;
  let openCrossings = 0;

  for (const e of list) {
    for (const m of LAY_METHODS) {
      const v = e.byMethod[m] ?? 0;
      if (v > 0) byMethod.set(m, (byMethod.get(m) ?? 0) + v);
    }
    for (const m of MATERIAL_KINDS) {
      const v = e.materials[m] ?? 0;
      if (v > 0) materials.set(m, (materials.get(m) ?? 0) + v);
    }
    drillM += e.drillM ?? 0;
    drillCount += e.drillCount ?? 0;
    blowingM += e.blowingM ?? 0;
    openCrossings += e.openCrossings ?? 0;
  }

  const out: VolumeRow[] = [];
  for (const m of LAY_METHODS) {
    const v = byMethod.get(m) ?? 0;
    if (v > 0) out.push({ key: m, label: LAY_METHOD_LABEL[m], unit: 'м', quantity: v });
  }
  if (drillM > 0) {
    out.push({ key: 'drillM', label: 'Переходы ГНБ / ГНП', unit: 'м', quantity: drillM });
  }
  if (drillCount > 0) {
    out.push({ key: 'drillCount', label: 'Переходов ГНБ / ГНП', unit: 'шт', quantity: drillCount });
  }
  if (openCrossings > 0) {
    out.push({ key: 'openCrossings', label: 'Переходы открытым способом', unit: 'шт', quantity: openCrossings });
  }
  if (blowingM > 0) {
    out.push({ key: 'blowingM', label: 'Задувка ОК', unit: 'м', quantity: blowingM });
  }
  for (const m of MATERIAL_KINDS) {
    const v = materials.get(m) ?? 0;
    if (v > 0) out.push({ key: `mat-${m}`, label: m, unit: MATERIAL_UNIT[m], quantity: v });
  }

  const dates = list.map((e) => e.date).filter(Boolean).sort();
  return {
    from: filter.from || dates[0] || '',
    to: filter.to || dates[dates.length - 1] || '',
    rows: out,
    totalM: list.reduce((s, e) => s + entryMeters(e), 0),
    sections: [...new Set(list.map((e) => e.uchastok).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, 'ru'),
    ),
    shifts: list.length,
  };
}

/** Расценка за единицу: метр прокладки, штука перехода. */
export type WorkPrices = Partial<Record<string, number>>;

export interface CostRow extends VolumeRow {
  price?: number;
  sum?: number;
}

export interface CostSheet {
  rows: CostRow[];
  total: number;
  /** Позиции без расценки: их стоимость неизвестна, а не равна нулю. */
  unpriced: string[];
}

/**
 * Стоимость по факту.
 *
 * Позиция без расценки не стоит ноль — она стоит неизвестно сколько, и
 * в итог её класть нельзя. Такие называем отдельно: пусть человек
 * впишет расценку или объяснит заказчику, почему её нет.
 */
export function costSheet(sheet: VolumeSheet, prices: WorkPrices): CostSheet {
  const rows: CostRow[] = sheet.rows.map((r) => {
    const price = prices[r.key];
    return price !== undefined && price > 0
      ? { ...r, price, sum: r.quantity * price }
      : { ...r };
  });
  return {
    rows,
    total: rows.reduce((s, r) => s + (r.sum ?? 0), 0),
    unpriced: rows.filter((r) => r.sum === undefined).map((r) => r.label),
  };
}

const money = (v: number) => v.toLocaleString('ru', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const qty = (v: number) => v.toLocaleString('ru', { maximumFractionDigits: 2 });

export interface VolumeDocInput {
  sheet: VolumeSheet;
  cost?: CostSheet;
  /** Кому и от кого: подписи под таблицей. */
  contractor?: string;
  customer?: string;
  title?: string;
  /** Номер документа, если он есть. */
  number?: string;
}

/**
 * Ведомость документом.
 *
 * Тот же бланк годится и как своя ведомость, и как приложение к КС-2:
 * различаются они колонкой цены и подписями, а не содержимым.
 */
export function volumeDocHtml(input: VolumeDocInput): string {
  const { sheet, cost } = input;
  const withMoney = !!cost;
  const title = input.title
    || (withMoney ? 'АКТ О ПРИЁМКЕ ВЫПОЛНЕННЫХ РАБОТ' : 'ВЕДОМОСТЬ ОБЪЁМОВ ВЫПОЛНЕННЫХ РАБОТ');

  const head = withMoney
    ? '<td class="val b">Ед.</td><td class="val b">Кол-во</td>'
      + '<td class="val b">Цена, ₸</td><td class="val b">Сумма, ₸</td>'
    : '<td class="val b">Ед.</td><td class="val b">Кол-во</td>';

  const rows = (cost?.rows ?? sheet.rows).map((r, i) => {
    const c = r as CostRow;
    return '<tr>'
      + `<td class="val">${i + 1}</td>`
      + `<td class="lbl">${esc(r.label)}</td>`
      + `<td class="val">${esc(r.unit)}</td>`
      + `<td class="val">${qty(r.quantity)}</td>`
      + (withMoney
        ? `<td class="val">${c.price !== undefined ? money(c.price) : '—'}</td>`
          + `<td class="val">${c.sum !== undefined ? money(c.sum) : '—'}</td>`
        : '')
      + '</tr>';
  }).join('');

  const totalRow = withMoney
    ? '<tr><td class="val"></td><td class="lbl b">Итого</td>'
      + '<td class="val"></td><td class="val"></td><td class="val"></td>'
      + `<td class="val b">${money(cost!.total)}</td></tr>`
    : '<tr><td class="val"></td><td class="lbl b">Итого проложено</td>'
      + `<td class="val b">м</td><td class="val b">${qty(sheet.totalM)}</td></tr>`;

  const period = sheet.from === sheet.to
    ? fmtDate(sheet.from)
    : `${fmtDate(sheet.from)} — ${fmtDate(sheet.to)}`;

  return `<h1>${esc(title)}</h1>`
    + (input.number ? `<p class="center">№ ${esc(input.number)}</p>` : '')
    + `<p class="center">за период ${esc(period)}</p>`
    + (input.contractor ? `<p>Подрядчик: <span class="b">${esc(input.contractor)}</span></p>` : '')
    + (input.customer ? `<p>Заказчик: <span class="b">${esc(input.customer)}</span></p>` : '')
    + (sheet.sections.length
      ? `<p>Участки: ${esc(sheet.sections.join('; '))}</p>` : '')
    + `<p>Смен в периоде: ${sheet.shifts}</p>`
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="lbl b">Наименование работ</td>'
    + head
    + '</tr>'
    + rows
    + totalRow
    + '</table>'
    + (cost?.unpriced.length
      ? `<p class="warn">Без расценки: ${esc(cost.unpriced.join(', '))}. `
        + 'Эти позиции в сумму не вошли.</p>'
      : '')
    + '<table class="sign"><tr>'
    + '<td class="s">Сдал (подрядчик)<br/>_______________ / ______________</td>'
    + '<td class="s">Принял (заказчик)<br/>_______________ / ______________</td>'
    + '</tr></table>';
}

export function volumeDocFile(input: VolumeDocInput): string {
  const spec = input.cost ? 'КС-2' : 'Ведомость объёмов';
  const period = input.sheet.from === input.sheet.to
    ? input.sheet.from
    : `${input.sheet.from}—${input.sheet.to}`;
  return `${spec} ${period}.doc`;
}

/** Готовая страница Word: тот же стиль, что у актов. */
export function volumeDocPage(input: VolumeDocInput): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>${esc(input.title ?? 'Ведомость объёмов')}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 1.5cm; }
  body { margin: 0; }
${ACT_DOC_CSS}</style></head>
<body class="act-doc">${volumeDocHtml(input)}</body></html>`;
}
