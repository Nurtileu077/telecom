import { ImageResponse } from 'next/og';
import { pwaIconMarkup } from '@/lib/pwaIconImage';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon512() {
  return new ImageResponse(pwaIconMarkup(380), { ...size });
}
