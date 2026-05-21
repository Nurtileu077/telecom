import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon512() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(160deg, #0c1018 0%, #06080f 55%, #0a1628 100%)',
        }}
      >
        <div
          style={{
            width: 220,
            height: 220,
            borderRadius: 56,
            background: 'rgba(45, 212, 191, 0.15)',
            border: '6px solid rgba(45, 212, 191, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              background: 'linear-gradient(135deg, #2dd4bf, #818cf8)',
            }}
          />
        </div>
        <div
          style={{
            marginTop: 36,
            fontSize: 72,
            fontWeight: 800,
            color: '#f1f5f9',
            letterSpacing: 6,
          }}
        >
          OPTIQ
        </div>
      </div>
    ),
    { ...size },
  );
}
