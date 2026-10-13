import { buildDocx, docxFileName, type DocFormat } from './docxExport';
import { htmlToPdf, pdfFileName, stylesOf } from '@/lib/pdf';
import { ACT_DOC_CSS, DOC_MIME } from './actDocument';

/**
 * Один способ отдать документ — для всех экранов.
 *
 * АСР, ОСР, акт фиксации, тетрадь и протокол мобильной группы из
 * «Закрытия» скачивались своим кодом — старым HTML с расширением .doc,
 * который на телефоне куратора не открывается, — а Word, PDF и ссылка
 * были только на «Документах». Сборка файла одна, и выбор формата один:
 * какой документ ни возьми, он выходит так, как выбрано.
 */

/** Документ свёрстан на альбомный лист — так и собираем. */
export function isLandscapeDoc(html: string): boolean {
  // Смотрим только свои стили документа: приложение-схема внутри акта
  // несёт свою разметку, но лист у акта книжный.
  const head = html.split(/<body\b/i)[0] ?? '';
  return /@page\s*\{[^}]*size\s*:[^;}]*landscape/i.test(stylesOf(head));
}

/** Имя файла под выбранный вид: расширение меняется, имя — нет. */
export function fileNameFor(format: DocFormat, name: string): string {
  if (format === 'docx') return docxFileName(name);
  if (format === 'pdf') return pdfFileName(name);
  return `${name.replace(/\.(docx?|pdf)$/i, '')}.doc`;
}

export interface BuiltDoc {
  blob: Blob;
  /** Имя для скачивания. */
  file: string;
  /** Расширение для склада — по нему ссылка открывается нужной программой. */
  ext: 'doc' | 'docx' | 'pdf';
  /**
   * PDF вышел картинкой — шрифт текста не загрузился (нет связи).
   * Об этом говорят: из такого PDF ничего не скопировать.
   */
  imageOnly?: boolean;
}

/**
 * Собрать документ в выбранном виде.
 *
 * Альбомный лист, если его не назвали явно, узнаём по самому документу:
 * тетрадь технадзора свёрстана альбомом, и книжный .docx резал её
 * восемь колонок.
 */
export async function buildDocFile(
  format: DocFormat,
  name: string,
  html: string,
  landscape?: boolean,
): Promise<BuiltDoc> {
  const land = landscape ?? isLandscapeDoc(html);
  const file = fileNameFor(format, name);
  if (format === 'doc') {
    // BOM — иначе Word открывает кириллицу кракозябрами.
    return { blob: new Blob(['﻿', html], { type: DOC_MIME }), file, ext: 'doc' };
  }
  if (format === 'pdf') {
    const { blob, searchable } = await htmlToPdf(html, ACT_DOC_CSS, { landscape: land });
    return { blob, file, ext: 'pdf', imageOnly: !searchable };
  }
  return { blob: await buildDocx(html, { landscape: land }), file, ext: 'docx' };
}

/** Строка о том, что файл собран, — с оговоркой про PDF-картинку. */
export function builtNote(b: Pick<BuiltDoc, 'file' | 'imageOnly'>): string {
  return b.imageOnly
    ? `Файл собран: ${b.file}. PDF вышел картинкой — шрифт не загрузился без связи, текст из него не скопировать`
    : `Файл собран: ${b.file}`;
}
