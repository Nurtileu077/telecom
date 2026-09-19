'use client';
import { useMemo, useState } from 'react';
import { Network, Flame, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import {
  SiteObject, SpliceRecord, FiberSplice, SPLICE_LOSS_LIMIT_DB,
  SITE_OBJECT_SPECS, MUFTA_STATES,
} from '@/types/construction';
import { JournalState } from './journalStore';
import { passports, passportSummary } from './passport';

/**
 * Паспорт сети: как построено.
 *
 * Стройка кончится, а сеть останется. Этот экран отвечает на вопросы,
 * которые задают уже после сдачи: что это за муфта, откуда в неё приходит
 * свет, сколько волокон занято и какое затухание на стыках.
 *
 * Пустые места не прячем: у каждой карточки написано, чего не хватает.
 * Выдуманный паспорт хуже отсутствующего — по нему поедут искать.
 */

interface Props {
  journal: JournalState;
  author: string;
  onSaveSplice: (r: SpliceRecord) => void;
  onRemoveSplice: (id: string) => void;
  onEditObject?: (id: string) => void;
}

export default function PassportView({
  journal, author, onSaveSplice, onRemoveSplice, onEditObject,
}: Props) {
  const rows = useMemo(
    () => passports(journal.objects, journal.splices),
    [journal.objects, journal.splices],
  );
  const sum = useMemo(() => passportSummary(rows), [rows]);
  const [splicing, setSplicing] = useState<SiteObject | null>(null);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const shown = onlyIncomplete ? rows.filter((r) => r.missing.length > 0) : rows;

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 flex flex-col items-center gap-2">
        <Network size={22} className="text-[var(--text-muted)]" />
        <p className="text-[12.5px] text-[var(--text-muted)] max-w-sm">
          Паспорт пуст: муфт и конечных точек ещё нет. Они появляются в разделе
          «Объекты» — их заводит тот, кто их ставил.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi label="Муфты" value={String(sum.muftas)} note={`заварено ${sum.spliced}`} />
        <Kpi label="Конечные точки" value={String(sum.endpoints)} />
        <Kpi label="Волокон заведено" value={String(sum.fibersUsed)} />
        <Kpi label="Стыков выше нормы" value={String(sum.badSplices)}
             note={`норма ${SPLICE_LOSS_LIMIT_DB} дБ`} warn={sum.badSplices > 0} />
      </div>

      {sum.incomplete > 0 && (
        <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-muted)] cursor-pointer">
          <input type="checkbox" checked={onlyIncomplete}
                 onChange={(e) => setOnlyIncomplete(e.target.checked)}
                 className="accent-[var(--accent)]" />
          Показать только неполные ({sum.incomplete}) — за этим придётся ехать обратно
        </label>
      )}

      <div className="flex flex-col gap-2">
        {shown.slice(0, 200).map((p) => {
          const o = p.object;
          const spec = SITE_OBJECT_SPECS[o.kind];
          return (
            <div key={o.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[14px] leading-none">{spec.icon}</span>
                <span className="text-[12.5px] font-medium text-[var(--text)]">
                  {o.name || spec.label}
                </span>
                {o.kind === 'mufta' && (
                  <span className="text-[10px]" style={{ color: MUFTA_STATES[o.state ?? 'planned'].color }}>
                    ● {MUFTA_STATES[o.state ?? 'planned'].label}
                  </span>
                )}
                <span className="text-[10.5px] text-[var(--text-muted)] truncate">
                  {[o.uchastok, o.rayon].filter(Boolean).join(', ')}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {onEditObject && (
                    <button type="button" className="text-[11px] text-[var(--accent)] hover:underline"
                            onClick={() => onEditObject(o.id)}>
                      карточка
                    </button>
                  )}
                  <button type="button" className="btn text-[10.5px]"
                          onClick={() => setSplicing(o)}>
                    <Flame size={12} />Сварка
                  </button>
                </span>
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                {o.feedFrom && <span>от {o.feedFrom}</span>}
                {o.feedTo && <span>до {o.feedTo}</span>}
                {o.cable && <span>кабель {o.cable}</span>}
                {o.fibers !== undefined && (
                  <span>волокон {p.usedFibers} из {o.fibers}</span>
                )}
                {o.duct && <span>труба {o.duct}</span>}
                {o.depthM !== undefined && <span>глубина {String(o.depthM).replace('.', ',')} м</span>}
                {o.model && <span>{o.model}</span>}
              </div>

              {p.fibers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {p.fibers.map((f) => (
                    <span key={f.fiber}
                          className="text-[10px] px-1.5 py-0.5 rounded border font-mono"
                          style={{
                            color: f.bad ? 'var(--warn)' : 'var(--text-muted)',
                            borderColor: f.bad ? 'var(--warn)' : 'var(--border)',
                          }}
                          title={[f.to, f.lossDb !== undefined ? `${f.lossDb} дБ` : '']
                            .filter(Boolean).join(' · ')}>
                      {f.fiber}
                      {f.lossDb !== undefined && ` ${f.lossDb}`}
                    </span>
                  ))}
                </div>
              )}

              {p.splice && (
                <div className="flex items-baseline gap-2 text-[10.5px] text-[var(--text-muted)]">
                  <span>
                    Сварка {new Date(`${p.splice.date}T00:00:00Z`).toLocaleDateString('ru')}
                    {p.splice.crew ? ` · ${p.splice.crew}` : ''}
                    {p.splice.device ? ` · ${p.splice.device}` : ''}
                    {p.splice.waveNm ? ` · ${p.splice.waveNm} нм` : ''}
                  </span>
                  {p.splice.otdrUrl && (
                    <a href={p.splice.otdrUrl} target="_blank" rel="noreferrer"
                       className="text-[var(--accent)] hover:underline">рефлектограмма</a>
                  )}
                  <button type="button" onClick={() => onRemoveSplice(p.splice!.id)}
                          title="Удалить протокол"
                          className="ml-auto text-[var(--text-muted)] hover:text-[var(--danger)]">
                    <Trash2 size={12} />
                  </button>
                </div>
              )}

              {p.missing.length > 0 && (
                <div className="flex items-start gap-1.5 text-[10.5px] text-[var(--warn)]">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>Не записано: {p.missing.join(', ')}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10.5px] text-[var(--text-muted)]">
        Норма затухания на стыке — {SPLICE_LOSS_LIMIT_DB} дБ. Больше нормы
        помечается сразу, а не выясняется на приёмке.
      </p>

      {splicing && (
        <SpliceForm
          object={splicing}
          initial={journal.splices.find((s) => s.objectId === splicing.id)}
          author={author}
          onSave={(r) => { onSaveSplice(r); setSplicing(null); }}
          onClose={() => setSplicing(null)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, note, warn }: {
  label: string; value: string; note?: string; warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="text-[18px] font-semibold leading-tight"
           style={{ color: warn ? 'var(--warn)' : 'var(--text)' }}>{value}</div>
      {note && <div className="text-[10.5px] text-[var(--text-muted)]">{note}</div>}
    </div>
  );
}

/**
 * Протокол сварки. Волокна вводятся по одному: их двадцать четыре, а не
 * двести, и таблица здесь честнее, чем поле «затухание в среднем».
 */
function SpliceForm({ object, initial, author, onSave, onClose }: {
  object: SiteObject;
  initial?: SpliceRecord;
  author: string;
  onSave: (r: SpliceRecord) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const [crew, setCrew] = useState(initial?.crew ?? '');
  const [device, setDevice] = useState(initial?.device ?? '');
  const [wave, setWave] = useState(initial?.waveNm ? String(initial.waveNm) : '1550');
  const [otdrName, setOtdrName] = useState(initial?.otdrName ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [fibers, setFibers] = useState<{ fiber: string; lossDb: string; to: string }[]>(
    () => (initial?.fibers ?? []).map((f) => ({
      fiber: String(f.fiber),
      lossDb: f.lossDb === undefined ? '' : String(f.lossDb),
      to: f.to ?? '',
    })),
  );

  /** Заполнить номера волокон по кабелю — вводить 24 номера руками незачем. */
  const fill = () => {
    const n = object.fibers ?? 0;
    if (!n) return;
    setFibers(Array.from({ length: n }, (_, i) => ({
      fiber: String(i + 1), lossDb: '', to: '',
    })));
  };

  const num = (v: string) => {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  };

  const submit = () => {
    const list: FiberSplice[] = fibers
      .map((f) => ({ fiber: Number(f.fiber), lossDb: num(f.lossDb), to: f.to.trim() || undefined }))
      .filter((f) => Number.isFinite(f.fiber) && f.fiber > 0);
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? `sp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      objectId: object.id,
      date,
      crew: crew.trim() || undefined,
      device: device.trim() || undefined,
      waveNm: num(wave),
      fibers: list,
      otdrName: otdrName.trim() || undefined,
      otdrUrl: initial?.otdrUrl,
      note: note.trim() || undefined,
      author: initial?.author ?? author,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      sync: 'local',
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--bg-surface)] w-full max-w-[560px] max-h-full overflow-y-auto rounded-xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-surface)]">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            Протокол сварки — {object.name || 'муфта'}
          </h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Дата</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Кто варил</span>
              <input value={crew} onChange={(e) => setCrew(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Аппарат</span>
              <input value={device} onChange={(e) => setDevice(e.target.value)}
                     placeholder="Fujikura 70S"
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Длина волны, нм</span>
              <input value={wave} onChange={(e) => setWave(e.target.value.replace(/[^\d]/g, ''))}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)] font-mono" />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">Волокна ({fibers.length})</span>
            {object.fibers ? (
              <button type="button" onClick={fill}
                      className="text-[11px] text-[var(--accent)] hover:underline">
                заполнить номера 1—{object.fibers}
              </button>
            ) : (
              <span className="text-[10.5px] text-[var(--text-muted)]">
                число волокон в карточке муфты не записано
              </span>
            )}
            <button type="button"
                    onClick={() => setFibers((p) => [...p, { fiber: String(p.length + 1), lossDb: '', to: '' }])}
                    className="ml-auto text-[11px] text-[var(--accent)] hover:underline">
              <Plus size={12} className="inline" /> волокно
            </button>
          </div>

          <div className="flex flex-col gap-1 max-h-[260px] overflow-y-auto">
            {fibers.map((f, i) => {
              const loss = num(f.lossDb);
              const bad = loss !== undefined && loss > SPLICE_LOSS_LIMIT_DB;
              return (
                <div key={i} className="flex gap-1.5 items-center">
                  <input value={f.fiber} inputMode="numeric"
                         onChange={(e) => setFibers((p) => p.map((x, j) => j === i ? { ...x, fiber: e.target.value.replace(/[^\d]/g, '') } : x))}
                         className="w-12 bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[12px] text-[var(--text)] font-mono text-center" />
                  <input value={f.lossDb} inputMode="decimal" placeholder="дБ"
                         onChange={(e) => setFibers((p) => p.map((x, j) => j === i ? { ...x, lossDb: e.target.value.replace(/[^\d.,]/g, '') } : x))}
                         className="w-20 bg-[var(--bg-canvas)] border rounded px-2 py-1 text-[12px] font-mono tabular-nums"
                         style={{
                           color: bad ? 'var(--warn)' : 'var(--text)',
                           borderColor: bad ? 'var(--warn)' : 'var(--border)',
                         }} />
                  <input value={f.to} placeholder="куда уходит"
                         onChange={(e) => setFibers((p) => p.map((x, j) => j === i ? { ...x, to: e.target.value } : x))}
                         className="flex-1 bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[12px] text-[var(--text)]" />
                  <button type="button" onClick={() => setFibers((p) => p.filter((_, j) => j !== i))}
                          className="text-[var(--text-muted)] hover:text-[var(--danger)]">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">Рефлектограмма — имя файла</span>
            <input value={otdrName} onChange={(e) => setOtdrName(e.target.value)}
                   placeholder="OTDR_муфта3_1550.sor"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
            <span className="text-[10.5px] text-[var(--text-muted)]">
              Сам файл прикладывается к письму: здесь он нужен как ссылка на
              то, чем подтверждено измерение.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">Примечание</span>
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
          </label>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)] sticky bottom-0 bg-[var(--bg-surface)]">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary flex-1" onClick={submit}>
            Сохранить протокол
          </button>
        </div>
      </div>
    </div>
  );
}
