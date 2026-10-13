'use client';
import { Copy, Link as LinkIcon, Loader2 } from 'lucide-react';
import { DOC_FORMATS, DOC_FORMAT_LABEL, DOC_FORMAT_HINT } from './docxExport';
import { LINK_LIVES, validFor } from '@/lib/docLink';
import type { DocOutput } from './useDocOutput';
import type { SharedDoc } from './docShare';

/**
 * Выбор формата, срок ссылки и сама ссылка — одни и те же на «Документах»
 * и в «Закрытии». Разметка общая, чтобы два экрана не разошлись: на
 * одном Word и ссылка, на другом — только старый .doc.
 */

/** «Сохранять как»: Word, PDF, старый .doc. */
export function FormatChips({ out }: { out: DocOutput }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-[var(--text-muted)]">Сохранять как</span>
      {DOC_FORMATS.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => out.setFormat(f)}
          title={DOC_FORMAT_HINT[f]}
          className={`chip ${f === out.format ? 'chip-on' : ''}`}
        >
          {DOC_FORMAT_LABEL[f]}
        </button>
      ))}
      {out.busy && <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" />}
      <span className="w-full text-[10.5px] text-[var(--text-muted)]">
        {DOC_FORMAT_HINT[out.format]}
      </span>
    </div>
  );
}

/** Сколько живёт ссылка. Без облака не показывается: ссылку давать неоткуда. */
export function LinkLifeChips({ out }: { out: DocOutput }) {
  if (!out.cloudReady) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-[var(--text-muted)]">Ссылка живёт</span>
      {LINK_LIVES.map((l) => (
        <button
          key={l.key}
          type="button"
          onClick={() => out.setLinkLife(l.key)}
          title={l.hint}
          className={`chip ${l.key === out.linkLife ? 'chip-on' : ''}`}
        >
          {l.label}
        </button>
      ))}
      <span className="w-full text-[10.5px] text-[var(--text-muted)]">
        Заказчику не нужен вход: ссылка подписанная. Срок нужен потому, что
        письма пересылают, а папки «Загрузки» живут годами.
      </span>
    </div>
  );
}

/** Готовая ссылка с письмом — скопировать и закрыть. */
export function LinkPanel({ out, onFlash }: { out: DocOutput; onFlash?: (t: string) => void }) {
  const link = out.link;
  if (!link) return null;
  return (
    <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)] p-3 space-y-2">
      <div className="flex items-baseline gap-2">
        <LinkIcon size={13} className="text-[var(--accent)]" />
        <span className="text-[12.5px] font-semibold text-[var(--text)] min-w-0 flex-1 truncate">
          {link.subject}
        </span>
        <span className="text-[10.5px] text-[var(--text-muted)] shrink-0">
          {validFor(link.until, new Date())}
        </span>
      </div>
      <textarea
        readOnly
        value={link.text}
        rows={4}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Письмо со ссылкой"
        className="w-full bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                   px-2 py-1.5 text-[11px] text-[var(--text)] font-mono"
      />
      <div className="flex gap-1.5 flex-wrap">
        <button type="button" className="btn btn-ghost text-[11px]"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.text);
                    onFlash?.('Скопировано');
                  } catch {
                    onFlash?.('Выделите текст и скопируйте вручную');
                  }
                }}>
          <Copy size={13} />Скопировать письмо
        </button>
        <button type="button" className="btn btn-ghost text-[11px]"
                onClick={() => out.setLink(null)}>
          Закрыть
        </button>
      </div>
      <div className="text-[10.5px] text-[var(--text-muted)] leading-snug">
        Соберёте документ заново — по этой же ссылке будет новая версия.
        Перезапрашивать её заказчику не нужно. Отчёт за другие даты, по
        другой области, подрядчику или проекту получает свою ссылку и эту
        не заменит.
      </div>
    </div>
  );
}

/**
 * «Ссылкой» рядом с кнопкой документа.
 *
 * HTML собирается только по нажатию: документ может быть тяжёлым, а
 * кнопок на экране десяток.
 */
export function ShareButton({
  out, doc, html, landscape, disabled, compact,
}: {
  out: DocOutput;
  doc: SharedDoc | null;
  html: () => string | null;
  landscape?: boolean;
  disabled?: boolean;
  /** Только значок — когда рядом с кнопкой документа места мало. */
  compact?: boolean;
}) {
  if (!out.cloudReady) return null;
  return (
    <button
      type="button"
      className={compact ? 'btn btn-ghost btn-icon' : 'btn btn-ghost text-[11.5px]'}
      disabled={out.busy || disabled || !doc}
      title={doc
        ? `Своя ссылка: ${doc.title}. Заказчик всегда открывает текущую версию`
        : 'Отдать ссылкой: заказчик всегда открывает текущую версию'}
      aria-label={doc ? `Ссылкой: ${doc.title}` : 'Ссылкой'}
      onClick={() => {
        const body = html();
        if (doc && body) void out.share(doc, body, landscape);
      }}
    >
      <LinkIcon size={14} />{compact ? null : 'Ссылкой'}
    </button>
  );
}
