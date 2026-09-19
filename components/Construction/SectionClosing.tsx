'use client';
import { useState, useMemo } from 'react';
import { Printer, AlertTriangle, FileCheck2, FileDown } from 'lucide-react';
import { JournalState, documentContractor } from './journalStore';
import {
  computeSectionAct, entriesOfSection, deviationsOfSection,
  SectionActManual, DEFAULT_ACT_MANUAL, Recultivation, PavementRestore,
} from './sectionAct';
import {
  actDocBody, actDocHtml, actFileName, ACT_DOC_CSS,
  ActKind, ACT_KIND_SPECS, DOC_MIME, ActDocInput,
  fixationDocHtml, fixationFileName,
} from './actDocument';
import { supervisionDocHtml, supervisionFileName } from './supervisionLog';

/**
 * Закрытие участка: АСР и ОСР по бланкам заказчика, заполненные из журнала.
 *
 * На экране показывается не пересказ акта, а сам акт: та же разметка, что
 * уходит в файл. Пересказ всегда однажды разойдётся с документом, и заметят
 * это на приёмке.
 *
 * Актов столько, сколько фактических глубин на участке: основной по проекту
 * и по одному на каждое отклонение. Строки, которые считаются из дневных
 * записей, подставлены; то, чего в журнале нет по существу, остаётся полями.
 */

interface Props {
  journal: JournalState;
  onChangeFields: (uchastok: string, fields: SectionActManual) => void;
}

const RECULT: Recultivation[] = ['выполнена', 'не выполнена'];
const PAVEMENT: PavementRestore[] = [
  'выполнено', 'не выполнено', 'выполнено частично',
  'не требуется', 'не предусмотрено проектом',
];

export default function SectionClosing({ journal, onChangeFields }: Props) {
  const sections = useMemo(() => {
    const s = new Set<string>();
    for (const e of journal.ground) if (e.uchastok) s.add(e.uchastok);
    return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [journal.ground]);

  const [uchastok, setUchastok] = useState(sections[0] ?? '');
  const [kind, setKind] = useState<ActKind>('OSR');

  const entries = useMemo(() => entriesOfSection(journal.ground, uchastok), [journal.ground, uchastok]);
  const devs = useMemo(() => deviationsOfSection(journal.deviations, uchastok), [journal.deviations, uchastok]);
  const totals = useMemo(() => computeSectionAct(entries, devs), [entries, devs]);

  const fields: SectionActManual = { ...DEFAULT_ACT_MANUAL, ...(journal.actFields?.[uchastok] ?? {}) };
  const setField = <K extends keyof SectionActManual>(k: K, v: SectionActManual[K]) => {
    onChangeFields(uchastok, { ...fields, [k]: v });
  };

  const first = entries[0];
  const performerName = totals.performers[0] ?? first?.contractor ?? '';
  const docContractor = performerName
    ? documentContractor(journal.contractors, performerName)
    : undefined;

  // Пустой акт хуже отсутствующего: его подпишут не глядя.
  const nothingToSign = totals.variants.length === 0;

  const docInput = (k: ActKind): ActDocInput => ({
    kind: k,
    uchastok,
    oblast: first?.oblast,
    rayon: first?.rayon,
    contractor: docContractor?.fullName ?? docContractor?.name,
    performer: performerName,
    dateFrom: totals.dateFrom,
    dateTo: totals.dateTo,
    totals, variants: totals.variants, fields,
  });

  /**
   * Акт файлом. Word-совместимый HTML: открывается как документ, правится
   * и уходит в письме — печать в PDF для этого не годится.
   */
  /** Один способ отдать документ файлом — для всех бланков сразу. */
  const download = (html: string, name: string) => {
    // BOM — иначе Word открывает кириллицу кракозябрами.
    const blob = new Blob(['﻿', html], { type: DOC_MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    // Якорь убираем не сразу: если удалить его в тот же тик, браузер
    // успевает потерять имя файла и сохраняет документ как «download».
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  };

  const downloadAct = (k: ActKind) => {
    if (nothingToSign) return;
    download(actDocHtml(docInput(k)), actFileName(k, uchastok, fields.actDate));
  };

  /**
   * Акт фиксации участка. Берём тот же первый вариант, что и в
   * освидетельствовании: основной по проектной глубине, а если весь
   * участок прошёл с отклонением — его, с фактической глубиной.
   */
  const downloadFixation = () => {
    if (nothingToSign) return;
    const v = totals.variants[0];
    download(fixationDocHtml({
      uchastok,
      oblast: first?.oblast,
      rayon: first?.rayon,
      contractor: docContractor?.fullName ?? docContractor?.name,
      performer: performerName,
      fromPoint: fields.volsFrom,
      toPoint: fields.volsTo,
      lengthM: v.lengthM,
      designDepthM: v.designDepthM,
      actualDepthM: v.actualDepthM,
      dateFrom: totals.dateFrom,
      dateTo: totals.dateTo,
      tusm: fields.tusm,
    }), fixationFileName(uchastok, fields.actDate));
  };

  /** Тетрадь технадзора за период работ — из тех же дневных записей. */
  const downloadSupervision = () => {
    download(supervisionDocHtml({
      entries,
      deviations: devs,
      from: totals.dateFrom,
      to: totals.dateTo,
      contractor: docContractor?.fullName ?? docContractor?.name,
      oblast: first?.oblast,
      rayon: first?.rayon,
      uchastok,
    }), supervisionFileName(uchastok, totals.dateFrom, totals.dateTo));
  };

  if (sections.length === 0) {
    return (
      <div className="text-center py-12 flex flex-col items-center gap-2">
        <FileCheck2 size={22} className="text-[var(--text-muted)]" />
        <p className="text-[12.5px] text-[var(--text-muted)]">
          Нет участков: загрузите журнал или внесите дневные отчёты
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Выбор участка — на печать не идёт */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <select id="sc-uchastok" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                className="flex-1 min-w-[220px] bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)]">
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md">
          {(['OSR', 'ASR'] as ActKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
                    className={`px-2.5 py-1 text-[11px] rounded ${
                      kind === k ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {ACT_KIND_SPECS[k].short}
            </button>
          ))}
        </div>
        <button type="button" className="btn text-[11px]"
                disabled={nothingToSign}
                title={nothingToSign
                  ? 'По участку нет объёмов прокладки — акт составлять не из чего'
                  : `Скачать ${ACT_KIND_SPECS[kind].short} — открывается в Word`}
                onClick={() => downloadAct(kind)}>
          <FileDown size={14} />Скачать {ACT_KIND_SPECS[kind].short}
        </button>
        <button type="button" className="btn text-[11px]"
                disabled={nothingToSign}
                title="Акт фиксации участка: границы, протяжённость, фактическая глубина"
                onClick={downloadFixation}>
          <FileDown size={14} />Акт фиксации
        </button>
        <button type="button" className="btn text-[11px]"
                disabled={entries.length === 0}
                title="Тетрадь технадзора по форме КТ/33.07.25 за период работ по участку"
                onClick={downloadSupervision}>
          <FileDown size={14} />Тетрадь
        </button>
        <button type="button" className="btn btn-primary text-[11px]" onClick={() => window.print()}>
          <Printer size={14} />Печать
        </button>
      </div>

      {nothingToSign && (
        <div className="no-print flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-muted)]">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>
            По участку «{uchastok}» нет объёмов прокладки — в дневных отчётах
            метры по способам не проставлены. Акт составлять не из чего.
          </span>
        </div>
      )}

      {totals.openDeviations.length > 0 && (
        <div className="no-print flex items-start gap-2 p-2.5 rounded-lg border border-[var(--warn)]/50 bg-[var(--warn)]/10 text-[12px] text-[var(--text)]">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
          <span>
            Участок нельзя закрыть: <b>{totals.openDeviations.length}</b> отклонений без протокола
            мобильной группы. Его номер должен попасть в пункт об отклонениях от ПСД.
          </span>
        </div>
      )}

      {/* Ручные поля — их нет в дневном отчёте */}
      <details className="no-print rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
        <summary className="px-3 py-2 text-[11.5px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)]">
          Поля бланка, которых нет в журнале — заполните вручную
        </summary>
        <div className="p-3 pt-0 flex flex-col gap-3">
          <Group title="Реквизиты">
            <Txt label="Номер акта" value={fields.actNumber} onChange={(v) => setField('actNumber', v)} />
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Дата акта</span>
              <input type="date" value={fields.actDate ?? ''}
                     onChange={(e) => setField('actDate', e.target.value || undefined)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)]" />
            </label>
            <Txt label="Город" value={fields.city} onChange={(v) => setField('city', v)} />
            <Txt label="Генподрядчик" value={fields.genContractor} onChange={(v) => setField('genContractor', v)} />
          </Group>

          <Group title="Участок ВОЛС">
            <Txt label="От (точка А)" value={fields.volsFrom} onChange={(v) => setField('volsFrom', v)} />
            <Txt label="До (точка Б)" value={fields.volsTo} onChange={(v) => setField('volsTo', v)} />
            <Txt label="Сельский округ" value={fields.selsovet} onChange={(v) => setField('selsovet', v)} />
            <Txt label="№ ТУСМ (подпись ОСР)" value={fields.tusm} onChange={(v) => setField('tusm', v)} />
          </Group>

          <Group title="Переходы, м">
            <Num label="ГНБ с ПЭТ-63" value={fields.gnbPet63M} onChange={(v) => setField('gnbPet63M', v)} />
            <Num label="ГНБ с ПЭТ-110" value={fields.gnbPet110M} onChange={(v) => setField('gnbPet110M', v)} />
            <Num label="Открытый, ПЭТ-63" value={fields.openPet63M} onChange={(v) => setField('openPet63M', v)} />
            <Num label="Открытый, ст. труба" value={fields.openSteel63M} onChange={(v) => setField('openSteel63M', v)} />
          </Group>

          <Group title="После таблицы">
            <Num label="Столбиков, шт" value={fields.markerPosts} onChange={(v) => setField('markerPosts', v)} />
            <Num label="Шаровых маркеров, шт" value={fields.ballMarkers} onChange={(v) => setField('ballMarkers', v)} />
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Рекультивация</span>
              <select value={fields.recultivation} onChange={(e) => setField('recultivation', e.target.value as Recultivation)}
                      className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)]">
                {RECULT.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">А/бетонные покрытия</span>
              <select value={fields.pavement} onChange={(e) => setField('pavement', e.target.value as PavementRestore)}
                      className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)]">
                {PAVEMENT.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <Txt label="Обваловка" value={fields.obvalovka} onChange={(v) => setField('obvalovka', v)} />
          </Group>

          <Wide label="Наименование объекта (АСР)" value={fields.objectName}
                onChange={(v) => setField('objectName', v)}
                hint="Пусто — соберётся из точек А/Б, области и района" />
          <Wide label="Проектно-сметная документация (АСР, п.2)" value={fields.psd}
                onChange={(v) => setField('psd', v)} />
          <Wide label="Применённые материалы" value={fields.materials}
                onChange={(v) => setField('materials', v)} />
          <Wide label="Последующие работы (АСР, решение комиссии)" value={fields.nextWorks}
                onChange={(v) => setField('nextWorks', v)} />
          <Wide label="Дополнительные участники освидетельствования (АСР)"
                value={fields.extraParticipants}
                onChange={(v) => setField('extraParticipants', v)} />
        </div>
      </details>

      {/* Сам документ: то же, что уйдёт в файл */}
      <div className="print-area act-preview">
        {!nothingToSign && (
          <div className="act-doc" dangerouslySetInnerHTML={{ __html: actDocBody(docInput(kind)) }} />
        )}
      </div>

      <p className="no-print text-[10.5px] text-[var(--text-muted)]">
        Объёмы по способам, лента и фитинги делятся между актами пропорционально
        протяжённости — журнал ведётся по дням, а не по глубине, поэтому точное
        распределение знает только исполнитель. Проверьте перед подписанием.
      </p>

      {/* Оформление бланка — общее с файлом, чтобы предпросмотр не врал */}
      <style dangerouslySetInnerHTML={{ __html: ACT_DOC_CSS }} />
      <style jsx global>{`
        .act-preview .act-doc { background: transparent; }
        .act-preview .act-doc .sheet {
          background: #fff;
          padding: 16mm 14mm;
          margin-bottom: 10px;
          border-radius: 4px;
          overflow-x: auto;
        }
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; inset: 0; padding: 0; }
          .no-print { display: none !important; }
          .act-preview .act-doc .sheet {
            padding: 0;
            border-radius: 0;
            margin: 0;
            page-break-after: always;
          }
        }
      `}</style>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1.5">{title}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{children}</div>
    </section>
  );
}

function Txt({ label, value, onChange }: {
  label: string; value?: string; onChange: (v: string | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-[var(--text-muted)] truncate" title={label}>{label}</span>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}
             className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)]" />
    </label>
  );
}

function Wide({ label, value, onChange, hint }: {
  label: string; value?: string; onChange: (v: string | undefined) => void; hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-[var(--text-muted)]">
        {label}{hint && <span className="ml-1 text-[var(--text-muted)]/70">— {hint}</span>}
      </span>
      <textarea rows={2} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}
                className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)] resize-y" />
    </label>
  );
}

function Num({ label, value, onChange }: {
  label: string; value?: number; onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-[var(--text-muted)] truncate" title={label}>{label}</span>
      <input inputMode="decimal" value={value === undefined ? '' : String(value)}
             onChange={(e) => {
               const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
               const n = parseFloat(raw);
               onChange(raw === '' || !Number.isFinite(n) ? undefined : n);
             }}
             placeholder="0"
             className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)] font-mono tabular-nums" />
    </label>
  );
}
