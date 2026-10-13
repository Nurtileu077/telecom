'use client';
import { useCallback, useState } from 'react';
import {
  loadDocFormat, saveDocFormat, type DocFormat,
} from './docxExport';
import { buildDocFile, builtNote } from './docOutput';
import { downloadBlob } from '@/lib/download';
import { shareDocument } from '@/lib/supabase';
import { journalCloudEnabled } from './journalRemote';
import { DEFAULT_LINK_LIFE, lifeByKey, linkMessage, validFor } from '@/lib/docLink';
import { errorLine } from '@/lib/errors';
import type { SharedDoc } from './docShare';

/** Готовая ссылка: что отдали, куда и до какого числа. */
export interface DocLink {
  url: string;
  until: string;
  text: string;
  subject: string;
}

/**
 * Сохранить или отдать ссылкой — одинаково на любом экране.
 *
 * Формат — настройка устройства, общая для «Документов» и «Закрытия»:
 * выбрал Word на одном экране — Word и на другом. Иначе прораб, однажды
 * выбравший .docx, получал из «Закрытия» старый .doc и не понимал почему.
 */
export function useDocOutput(onFlash?: (text: string) => void) {
  const [format, setFormatState] = useState<DocFormat>(() => loadDocFormat());
  const [linkLife, setLinkLife] = useState(DEFAULT_LINK_LIFE.key);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<DocLink | null>(null);
  // Без облака ссылку давать неоткуда: документ останется файлом.
  const cloudReady = journalCloudEnabled();

  const setFormat = useCallback((f: DocFormat) => {
    setFormatState(f);
    saveDocFormat(f);
  }, []);

  /**
   * Сохранить документ.
   *
   * PDF снимает страницу браузер, и на длинном документе это секунды:
   * без отметки о работе кнопка выглядит нажатой впустую, и её жмут ещё
   * раз.
   */
  const save = useCallback(async (name: string, html: string, landscape?: boolean) => {
    setBusy(true);
    try {
      const built = await buildDocFile(format, name, html, landscape);
      downloadBlob(built.file, built.blob);
      onFlash?.(builtNote(built));
    } catch (e) {
      onFlash?.(format === 'pdf'
        ? 'PDF не собрался. Сохраните в Word — документ тот же.'
        : errorLine(e, 'собрать документ'));
    } finally {
      setBusy(false);
    }
  }, [format, onFlash]);

  /**
   * Отдать ссылкой, а не файлом.
   *
   * Акт уходит вложением, потом в нём находят ошибку, отправляют второй —
   * и у заказчика их два, а какой верный, видно только по дате письма.
   * Ссылка одна, и по ней всегда то, что лежит сейчас. Собирается тем же
   * способом, что и файл: по ссылке уходит то же, что ушло бы вложением.
   */
  const share = useCallback(async (doc: SharedDoc, html: string, landscape?: boolean) => {
    setBusy(true);
    try {
      const subject = doc.title;
      const built = await buildDocFile(format, subject, html, landscape);
      const life = lifeByKey(linkLife);
      const { url, until } = await shareDocument(doc.address, built.ext, built.blob, life);
      const text = linkMessage(subject, url, life, until);
      setLink({ url, until, text, subject });
      const pdfNote = built.imageOnly ? ' PDF вышел картинкой — шрифт не загрузился.' : '';
      try {
        await navigator.clipboard.writeText(text);
        onFlash?.(`Ссылка скопирована, ${validFor(until, new Date())}.${pdfNote}`);
      } catch {
        onFlash?.(`Ссылка готова — скопируйте её ниже.${pdfNote}`);
      }
    } catch (e) {
      onFlash?.(errorLine(e, 'собрать ссылку'));
    } finally {
      setBusy(false);
    }
  }, [format, linkLife, onFlash]);

  return {
    format, setFormat, linkLife, setLinkLife, busy, setBusy, link, setLink, cloudReady, save, share,
  };
}

export type DocOutput = ReturnType<typeof useDocOutput>;
