import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OPTIQ',
  description: 'OPTIQ — проектирование оптических сетей камер (GPON/FTTH)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          crossOrigin=""
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
