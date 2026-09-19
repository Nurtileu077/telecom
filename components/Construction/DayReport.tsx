'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, MapPin, Wrench, Boxes, Building2, Ruler } from 'lucide-react';
import {
  LAY_METHODS, LAY_METHOD_LABEL, MATERIAL_UNIT, OPERATIONS,
  type LayMethod, type MaterialKind,
} from '@/types/construction';
import { JournalState, fmtKm, fmtMeters, MATERIAL_LABEL, plural } from './journalStore';
import { getPhotoBlob, GEO_SOURCE_LABEL } from './photoStore';
import type { FieldPhoto } from '@/types/construction';

/**
 * Что было в этот день.
 *
 * График выработки без этого экрана — картинка: видно, что двенадцатого
 * был провал, и непонятно почему. Здесь тот же день разложен на участки,
 * способы, материалы и исполнителей, то есть на то, из чего складывается
 * ответ «почему столько».
 */

interface Props {
  journal: JournalState;
  date: string;
  /**
   * Область, выбранная в сводке. Журнал приходит уже суженным — здесь
   * она нужна только чтобы сказать об этом вслух: иначе непонятно,
   * почему день выглядит меньше, чем был.
   */
  oblast?: string;
  onClose: () => void;
  /** Показать движение колонн этого дня на карте. */
  onPlay?: () => void;
}

function entryMeters(byMethod: Partial<Record<LayMethod, number>>): number {
  let m = 0;
  for (const v of Object.values(byMethod)) m += v ?? 0;
  return m;
}

export default function DayReport({ journal, date, oblast, onClose, onPlay }: Props) {
  const data = useMemo(() => {
    const ground = journal.ground.filter((e) => e.date === date);
    const aerial = journal.aerial.filter((e) => e.date === date);
    const drills = journal.drills.filter((e) => e.date === date);
    const deviations = journal.deviations.filter((d) => d.date === date);

    const byMethod: Partial<Record<LayMethod, number>> = {};
    const byMaterial: Partial<Record<MaterialKind, number>> = {};
    const byOblast = new Map<string, number>();
    const byContractor = new Map<string, number>();
    const bySection = new Map<string, { m: number; oblast: string; rayon?: string }>();
    const operations = new Map<string, number>();
    const equipment = new Map<string, number>();

    let groundM = 0;
    for (const e of ground) {
      const m = entryMeters(e.byMethod);
      groundM += m;
      for (const k of LAY_METHODS) {
        const v = e.byMethod[k] ?? 0;
        if (v) byMethod[k] = (byMethod[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(e.materials)) {
        if (v) byMaterial[k as MaterialKind] = (byMaterial[k as MaterialKind] ?? 0) + v;
      }
      const ob = e.oblast || 'Не указано';
      byOblast.set(ob, (byOblast.get(ob) ?? 0) + m);
      const c = e.contractor || e.smu || 'Не указано';
      byContractor.set(c, (byContractor.get(c) ?? 0) + m);
      const key = e.uchastok || e.kato || '—';
      const cur = bySection.get(key) ?? { m: 0, oblast: e.oblast, rayon: e.rayon };
      cur.m += m;
      bySection.set(key, cur);
      for (const [k, v] of Object.entries(e.operations ?? {})) {
        if (v) operations.set(k, (operations.get(k) ?? 0) + v);
      }
      for (const [k, v] of Object.entries(e.equipment ?? {})) {
        if (v) equipment.set(k, (equipment.get(k) ?? 0) + v);
      }
    }

    const aerialM = aerial.reduce((s, a) => s + (a.totalM ?? 0), 0);
    const drillM = drills.reduce((s, d) => s + (d.meters ?? 0), 0);
    const drillCount = drills.reduce((s, d) => s + (d.count || 0), 0);

    // Фото дня — по записям этого дня, а не по дате файла: снимок могли
    // приложить назавтра, но относится он к смене, к которой приложен.
    const ids = new Set([...ground, ...aerial, ...drills].map((e) => e.id));
    const photos = journal.photos.filter(
      (p) => ids.has(p.refId) || p.takenAt.slice(0, 10) === date,
    );

    return {
      ground, aerial, drills, deviations, photos,
      groundM, aerialM, drillM, drillCount,
      byMethod, byMaterial,
      oblasts: [...byOblast.entries()].sort((a, b) => b[1] - a[1]),
      contractors: [...byContractor.entries()].sort((a, b) => b[1] - a[1]),
      sections: [...bySection.entries()].sort((a, b) => b[1].m - a[1].m),
      operations: [...operations.entries()].sort((a, b) => b[1] - a[1]),
      equipment: [...equipment.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [journal, date]);

  const total = data.groundM + data.aerialM;
  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString('ru', {
    day: 'numeric', month: 'long', year: 'numeric', weekday: 'long',
  });

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-3 md:p-6"
         onClick={onClose}>
      <div className="w-full max-w-3xl max-h-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl"
           onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-[var(--text)] truncate">{pretty}</h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              {fmtKm(total)} км за день · {data.ground.length + data.aerial.length}{' '}
              {plural(data.ground.length + data.aerial.length, 'запись', 'записи', 'записей')}
              {/* Область выбрана в сводке — говорим об этом прямо, иначе
                  день выглядит меньше, чем он был, без объяснения. */}
              {oblast && <> · только <b className="text-[var(--text)]">{oblast}</b></>}
            </p>
          </div>
          {onPlay && (
            <button type="button" onClick={onPlay} className="btn btn-ghost text-[11px]"
                    title="Показать на карте, откуда куда дошли за этот день">
              ▶ Движение
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="btn btn-ghost btn-icon"><X size={16} /></button>
        </header>

        <div className="p-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Kpi label="Подземка" value={fmtKm(data.groundM)} unit="км" accent />
            <Kpi label="Подвес" value={fmtKm(data.aerialM)} unit="км" />
            <Kpi label="Бестраншейно" value={fmtKm(data.drillM)}
                 unit={`км · ${data.drillCount} ${plural(data.drillCount, 'прокол', 'прокола', 'проколов')}`} />
            <Kpi label="Отклонений" value={String(data.deviations.length)}
                 unit={data.deviations.length ? 'зафиксировано' : 'нет'}
                 warn={data.deviations.length > 0} />
          </div>

          {total === 0 && data.drills.length === 0 && (
            <p className="text-[12px] text-[var(--text-muted)]">
              За этот день записей нет. Такое бывает: выходной, перегон техники,
              ожидание согласования.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Block title="Участки" icon={<MapPin size={13} />}
                   rows={data.sections.map(([name, v]) => ({
                     name, value: `${fmtKm(v.m)} км`,
                     note: [v.oblast, v.rayon].filter(Boolean).join(', '),
                   }))} />
            <Block title="Способы прокладки" icon={<Wrench size={13} />}
                   rows={LAY_METHODS.filter((m) => data.byMethod[m]).map((m) => ({
                     name: LAY_METHOD_LABEL[m],
                     value: `${fmtKm(data.byMethod[m] ?? 0)} км`
                       + (data.groundM
                         ? `  ${Math.round(((data.byMethod[m] ?? 0) / data.groundM) * 100)}%`
                         : ''),
                   }))} />
            <Block title="Исполнители" icon={<Building2 size={13} />}
                   rows={data.contractors.map(([name, m]) => ({ name, value: `${fmtKm(m)} км` }))} />
            <Block title="Области" icon={<MapPin size={13} />}
                   rows={data.oblasts.map(([name, m]) => ({ name, value: `${fmtKm(m)} км` }))} />
            <Block title="Материалы" icon={<Boxes size={13} />}
                   rows={Object.entries(data.byMaterial).map(([k, v]) => ({
                     name: MATERIAL_LABEL[k as MaterialKind] ?? k,
                     value: MATERIAL_UNIT[k as MaterialKind] === 'м'
                       ? fmtMeters(v ?? 0)
                       : `${(v ?? 0).toLocaleString('ru')} шт`,
                   }))} />
            {data.operations.length > 0 && (
              <Block title="Операции" icon={<Ruler size={13} />}
                     rows={data.operations.map(([k, v]) => ({
                       name: OPERATIONS[k as keyof typeof OPERATIONS]?.label ?? k,
                       value: OPERATIONS[k as keyof typeof OPERATIONS]?.unit === 'шт'
                         ? `${v} шт` : fmtMeters(v),
                     }))} />
            )}
            {data.equipment.length > 0 && (
              <Block title="Техника на смене" icon={<Wrench size={13} />}
                     rows={data.equipment.map(([k, v]) => ({ name: k, value: `${v} ед.` }))} />
            )}
          </div>

          {data.drills.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Переходы ({data.drills.length})
              </h4>
              {data.drills.map((d) => (
                <div key={d.id} className="flex items-baseline gap-2 text-[11.5px] rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5">
                  <span className="text-[var(--accent)]">{d.drillKind}</span>
                  <span className="text-[var(--text)] truncate">{d.uchastok || '—'}</span>
                  <span className="ml-auto font-mono text-[var(--text-muted)] shrink-0">
                    {d.meters ? `${d.meters} м` : '—'}{d.count ? ` · ${d.count} шт` : ''}
                  </span>
                </div>
              ))}
            </section>
          )}

          {data.deviations.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Отклонения ({data.deviations.length})
              </h4>
              {data.deviations.map((d) => (
                <div key={d.id} className="text-[11.5px] rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-1.5">
                  <span className="text-[var(--text)]">{d.uchastok}</span>
                  <span className="text-[var(--text-muted)]"> · {d.lengthM} м · {d.reason}</span>
                  {d.actualDepthM !== undefined && (
                    <span className="font-mono text-[var(--warn)]"> · {String(d.actualDepthM).replace('.', ',')} м</span>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Фотографии дня: подтверждение того, что в цифрах не видно */}
          {data.photos.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Фотографии ({data.photos.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {data.photos.map((p) => <DayPhoto key={p.id} photo={p} />)}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-1.5">
            <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Записи дня ({data.ground.length + data.aerial.length})
            </h4>
            {[...data.ground, ...data.aerial].map((e) => (
              <div key={e.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5">
                <div className="flex items-baseline gap-2 text-[11.5px]">
                  <span className="text-[var(--text)] truncate">{e.uchastok || '—'}</span>
                  <span className="text-[10.5px] text-[var(--text-muted)] truncate">
                    {e.contractor || e.smu || ''}{e.column ? ` · ${e.column}` : ''}
                  </span>
                  <span className="ml-auto font-mono text-[var(--text-muted)] shrink-0">
                    {e.kind === 'ground' ? fmtKm(entryMeters(e.byMethod)) : fmtKm(e.totalM ?? 0)} км
                  </span>
                </div>
                {/* Кто закрыл день: спрашивать «чья это запись» не должно
                    приходиться — у дня есть автор, и он тут написан. */}
                {(e.author || e.editedBy) && (
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {e.author ? `закрыл ${e.author}` : 'автор не указан'}
                    {e.editedBy && `, правка от ${e.editedBy} подтверждена`}
                  </div>
                )}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, accent, warn }: {
  label: string; value: string; unit?: string; accent?: boolean; warn?: boolean;
}) {
  const color = warn ? 'var(--warn)' : accent ? 'var(--accent)' : 'var(--text)';
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="text-[18px] font-semibold leading-tight" style={{ color }}>{value}</div>
      {unit && <div className="text-[10.5px] text-[var(--text-muted)]">{unit}</div>}
    </div>
  );
}

function Block({ title, icon, rows }: {
  title: string; icon: React.ReactNode;
  rows: { name: string; value: string; note?: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
        {icon}{title}
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.slice(0, 12).map((r) => (
          <div key={r.name} className="py-0.5 border-b border-[var(--border)] last:border-0">
            <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="text-[var(--text)] truncate" title={r.name}>{r.name}</span>
              <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0">{r.value}</span>
            </div>
            {/* Пояснение — строкой ниже: рядом с названием оно съедало место
                и оставляло от названия участка три буквы с многоточием. */}
            {r.note && (
              <div className="text-[10px] text-[var(--text-muted)] truncate" title={r.note}>{r.note}</div>
            )}
          </div>
        ))}
        {rows.length > 12 && (
          <p className="text-[10.5px] text-[var(--text-muted)] pt-1">и ещё {rows.length - 12}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Снимок в отчёте дня. Пока фото не ушло в облако, показываем локальную
 * копию: ждать обмена, чтобы увидеть собственную фотографию, незачем.
 */
function DayPhoto({ photo }: { photo: FieldPhoto }) {
  const [src, setSrc] = useState<string | null>(photo.url ?? null);

  useEffect(() => {
    if (photo.url) { setSrc(photo.url); return; }
    let url: string | null = null;
    let alive = true;
    void getPhotoBlob(photo.id).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photo.id, photo.url]);

  const when = new Date(photo.takenAt);
  return (
    <figure className="w-[120px] m-0 rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-canvas)]">
      {src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt="" className="w-full h-[90px] object-cover" />
        : <div className="w-full h-[90px]" />}
      <figcaption className="px-1.5 py-1 text-[9.5px] text-[var(--text-muted)] leading-tight">
        {Number.isNaN(when.getTime())
          ? '—'
          : when.toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        <br />
        {GEO_SOURCE_LABEL[photo.geoSource]}
        {photo.uchastok && <><br />{photo.uchastok}</>}
      </figcaption>
    </figure>
  );
}
