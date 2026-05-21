import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <path d="M6 8c8 0 8 16 16 16" stroke="#2dd4bf" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M26 8c-8 0-8 16-16 16" stroke="#818cf8" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/>
  <circle cx="16" cy="16" r="3.5" fill="#2dd4bf"/>
</svg>`;

export default function Icon() {
  const logoSrc = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#06080f',
          borderRadius: 8,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} width={22} height={22} alt="" />
      </div>
    ),
    { ...size },
  );
}
