/**
 * Статические PNG для iOS Safari (/apple-touch-icon.png).
 * node scripts/generate-pwa-icons.mjs
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const PWA_ICON_BG = '#06080f';

function pwaIconSvg(size, cornerRadius = 0) {
  const pad = Math.round(size * 0.14);
  const inner = size - pad * 2;
  const scale = inner / 32;
  const rx = cornerRadius > 0 ? ` rx="${cornerRadius}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}"${rx} fill="${PWA_ICON_BG}"/>
  <g transform="translate(${pad}, ${pad}) scale(${scale})">
    <path d="M6 8c8 0 8 16 16 16" stroke="#2dd4bf" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <path d="M26 8c-8 0-8 16-16 16" stroke="#818cf8" stroke-width="2.2" stroke-linecap="round" fill="none" opacity="0.85"/>
    <circle cx="16" cy="16" r="3" fill="#2dd4bf"/>
  </g>
</svg>`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

async function main() {
  const { default: sharp } = await import('sharp');
  const files = [
    ['apple-touch-icon.png', 180, 36],
    ['icon-192.png', 192, 38],
    ['icon-512.png', 512, 100],
    ['favicon-32.png', 32, 6],
  ];
  for (const [name, size, radius] of files) {
    const png = await sharp(Buffer.from(pwaIconSvg(size, radius))).png().toBuffer();
    writeFileSync(join(publicDir, name), png);
    console.log('ok', name);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
