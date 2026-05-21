/** SVG логотипа как на сайте (Logo.tsx) — для PWA и apple-touch-icon */

export const PWA_ICON_BG = '#06080f';

/** Логотип 32×32: две дуги + точка, без текста */
export const SITE_LOGO_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <path d="M6 8c8 0 8 16 16 16" stroke="#2dd4bf" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M26 8c-8 0-8 16-16 16" stroke="#818cf8" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>
  <circle cx="16" cy="16" r="3" fill="#2dd4bf"/>
</svg>`;

export function pwaIconSvg(size: number, cornerRadius = 0): string {
  const pad = Math.round(size * 0.14);
  const inner = size - pad * 2;
  const scale = inner / 32;
  const tx = pad;
  const ty = pad;
  const rx = cornerRadius > 0 ? ` rx="${cornerRadius}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}"${rx} fill="${PWA_ICON_BG}"/>
  <g transform="translate(${tx}, ${ty}) scale(${scale})">
    <path d="M6 8c8 0 8 16 16 16" stroke="#2dd4bf" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <path d="M26 8c-8 0-8 16-16 16" stroke="#818cf8" stroke-width="2.2" stroke-linecap="round" fill="none" opacity="0.85"/>
    <circle cx="16" cy="16" r="3" fill="#2dd4bf"/>
  </g>
</svg>`;
}

export function logoMarkDataUri(): string {
  return `data:image/svg+xml,${encodeURIComponent(SITE_LOGO_MARK_SVG)}`;
}
