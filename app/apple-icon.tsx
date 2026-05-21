import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
            width: 88,
            height: 88,
            borderRadius: 22,
            background: 'rgba(45, 212, 191, 0.15)',
            border: '3px solid rgba(45, 212, 191, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              background: 'linear-gradient(135deg, #2dd4bf, #818cf8)',
            }}
          />
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 28,
            fontWeight: 800,
            color: '#f1f5f9',
            letterSpacing: 2,
          }}
        >
          OPTIQ
        </div>
      </div>
    ),
    { ...size },
  );
}
