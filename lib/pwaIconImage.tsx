import { logoMarkDataUri, PWA_ICON_BG } from './pwaLogoSvg';

/** Разметка для next/og ImageResponse — как иконка на рабочем столе */
export function pwaIconMarkup(logoPx: number) {
  const logoSrc = logoMarkDataUri();
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: PWA_ICON_BG,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoSrc} width={logoPx} height={logoPx} alt="" />
    </div>
  );
}
