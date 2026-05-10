import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GPON Network Designer',
  description: 'Professional GPON/FTTH optical network design tool',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
