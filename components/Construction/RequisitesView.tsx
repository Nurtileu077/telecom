'use client';
import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Building2 } from 'lucide-react';
import {
  withDefaults, missingForPayment, binLooksWrong, partyLine, contractLine,
  PARTY_FIELDS, type Requisites, type Party,
} from './requisites';

/**
 * Реквизиты сторон.
 *
 * Заполняют один раз — и документы перестают требовать правки после
 * выгрузки. Пока заказчик один, это выглядит лишним; когда подряд
 * меняется, без этого приходится открывать каждый файл и переписывать
 * шапку руками.
 *
 * Показываем сразу, как получится в документе: строка реквизитов в акте
 * длинная, и понять по отдельным полям, что выйдет, нельзя.
 */

interface Props {
  requisites?: Requisites;
  onSave: (r: Requisites) => void;
  onFlash?: (text: string) => void;
}

const SIDES: { key: 'contractor' | 'customer'; label: string; hint: string }[] = [
  { key: 'contractor', label: 'Подрядчик', hint: 'от чьего имени сдаются работы' },
  { key: 'customer', label: 'Заказчик', hint: 'кому сдаются' },
];

export default function RequisitesView({ requisites, onSave, onFlash }: Props) {
  const [draft, setDraft] = useState<Requisites>(() => withDefaults(requisites));
  const [saved, setSaved] = useState(false);

  const missing = useMemo(() => missingForPayment(draft), [draft]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(withDefaults(requisites)),
    [draft, requisites],
  );

  function setField(side: 'contractor' | 'customer', key: keyof Party, value: string) {
    setDraft((d) => ({ ...d, [side]: { ...d[side], [key]: value } }));
    setSaved(false);
  }

  function save() {
    onSave(draft);
    setSaved(true);
    onFlash?.('Реквизиты записаны');
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-start gap-2 text-[11.5px] text-[var(--text-muted)]">
        <Building2 size={14} className="shrink-0 mt-0.5" />
        <span>
          Заполняются один раз и подставляются во все документы. Уезжают на обмен
          вместе с журналом — у бригады в поле те же реквизиты, что в конторе.
        </span>
      </div>

      {SIDES.map((side) => (
        <div key={side.key}
             className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-[var(--text)]">{side.label}</span>
            <span className="text-[10.5px] text-[var(--text-muted)]">{side.hint}</span>
          </div>

          {PARTY_FIELDS.map((f) => {
            const value = draft[side.key][f.key] ?? '';
            const wrong = f.key === 'bin' && binLooksWrong(value);
            return (
              <label key={f.key} className="block">
                <span className="block text-[10.5px] text-[var(--text-muted)]">
                  {f.label}
                  {f.hint ? ` · ${f.hint}` : ''}
                </span>
                <input
                  value={value}
                  onChange={(e) => setField(side.key, f.key, e.target.value)}
                  className={`w-full bg-[var(--bg-canvas)] border rounded px-2 py-1
                              text-[12px] text-[var(--text)] ${
                    wrong ? 'border-[var(--warn)]' : 'border-[var(--border)]'}`}
                />
                {wrong && (
                  <span className="block text-[10px] text-[var(--warn)]">
                    БИН — двенадцать цифр. Ошибку в нём находят в бухгалтерии заказчика.
                  </span>
                )}
              </label>
            );
          })}

          {/* Как это встанет в документ — по отдельным полям не видно. */}
          {partyLine(draft[side.key]) && (
            <div className="rounded border border-[var(--border)] bg-[var(--bg-canvas)]
                            px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
              В документе: {partyLine(draft[side.key])}
            </div>
          )}
        </div>
      ))}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="text-[13px] font-semibold text-[var(--text)]">Договор</div>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="block text-[10.5px] text-[var(--text-muted)]">Номер</span>
            <input
              value={draft.contractNumber ?? ''}
              onChange={(e) => { setDraft((d) => ({ ...d, contractNumber: e.target.value })); setSaved(false); }}
              className="w-full bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                         px-2 py-1 text-[12px] text-[var(--text)]"
            />
          </label>
          <label className="flex-1">
            <span className="block text-[10.5px] text-[var(--text-muted)]">Дата</span>
            <input
              type="date"
              value={draft.contractDate ?? ''}
              onChange={(e) => { setDraft((d) => ({ ...d, contractDate: e.target.value })); setSaved(false); }}
              className="w-full bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                         px-2 py-1 text-[12px] text-[var(--text)]"
            />
          </label>
        </div>
        {contractLine(draft) && (
          <div className="text-[11px] text-[var(--text-muted)]">
            В документе: {contractLine(draft)}
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40
                        bg-[var(--warn)]/10 px-3 py-2 text-[11.5px] text-[var(--warn)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Для акта на оплату не хватает: {missing.join(', ')}.
            <span className="block text-[var(--text-muted)]">
              Для наряда бригаде хватает и одного названия — этот список про
              документы, которые уходят в бухгалтерию.
            </span>
          </span>
        </div>
      )}

      <button type="button" className="btn btn-primary text-[12px]"
              disabled={!dirty} onClick={save}>
        {saved && !dirty ? <Check size={14} /> : null}
        {saved && !dirty ? 'Записано' : 'Записать реквизиты'}
      </button>
    </div>
  );
}
