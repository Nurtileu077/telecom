import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
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
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #2dd4bf 0%, #818cf8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: 4, background: '#06080f' }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
