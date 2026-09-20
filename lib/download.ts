/**
 * Отдать файл человеку.
 *
 * Один и тот же десяток строк — создать ссылку, кликнуть, убрать за
 * собой — повторялся в каждом месте, где что-то выгружается. Забытый
 * revokeObjectURL держит файл в памяти вкладки до её закрытия, а на
 * планшете с пятью открытыми актами это уже заметно.
 */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Ссылку убираем не сразу: Safari успевает начать скачивание не всегда.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Текстовый файл.
 *
 * BOM обязателен для всего, что откроют в Word или Excel: без него
 * кириллица превращается в кракозябры, и это первое, что замечает тот,
 * кому файл отправили.
 */
export function downloadText(
  filename: string,
  text: string,
  mime = 'text/plain;charset=utf-8',
  bom = true,
): void {
  downloadBlob(filename, new Blob(bom ? ['﻿', text] : [text], { type: mime }));
}
