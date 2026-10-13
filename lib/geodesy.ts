/**
 * Расстояние между двумя точками на земле.
 *
 * Долго считали по шару радиусом 6 371 км. Земля сплюснута, и шар в
 * Казахстане даёт короче настоящего: трасса в 12 км с запада на восток у
 * Астаны выходила на 38 м короче, магистраль в 200 км — на 630 м, и эта
 * цифра шла в «Протяжённость» исполнительной схемы. Координаты в KML и с
 * телефона — WGS-84, и мерить их надо на том же эллипсоиде, на котором
 * их сняли.
 *
 * Считаем по Винсенти: на расстояниях стройки он точнее миллиметра, а
 * обходится немногим дороже шара — перерисовка карты этого не заметит.
 */

/** Большая полуось WGS-84, метры. */
export const WGS84_A = 6378137;
/** Сжатие WGS-84. */
export const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);

/** Радиус шара, которым считали раньше. */
export const SPHERE_R = 6371000;

const rad = (d: number) => (d * Math.PI) / 180;

/** Чем мерить: долготы и широты в градусах, ответ в метрах. */
export type Metric = (lat1: number, lon1: number, lat2: number, lon2: number) => number;

/** По шару — как считали до перехода на эллипсоид. */
export const sphereM: Metric = (lat1, lon1, lat2, lon2) => {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return SPHERE_R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * По эллипсоиду WGS-84 — обратная задача Винсенти.
 *
 * Для почти противоположных точек планеты итерация не сходится; на
 * стройке таких расстояний нет, но и NaN в длину трассы пускать нельзя —
 * тогда отвечаем по шару среднего радиуса, ошибка там меньше процента.
 */
export const ellipsoidM: Metric = (lat1, lon1, lat2, lon2) => {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const f = WGS84_F;
  const L = rad(lon2 - lon1);
  const U1 = Math.atan((1 - f) * Math.tan(rad(lat1)));
  const U2 = Math.atan((1 - f) * Math.tan(rad(lat2)));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cos2Alpha = 0;
  let cos2SigmaM = 0;
  for (let i = 0; i < 200; i += 1) {
    const sinL = Math.sin(lambda);
    const cosL = Math.cos(lambda);
    const t1 = cosU2 * sinL;
    const t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosL;
    sinSigma = Math.sqrt(t1 * t1 + t2 * t2);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    // На экваторе cos²α = 0, и формула для 2σm делит на ноль.
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha
      * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) <= 1e-12) {
      const u2 = (cos2Alpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
      const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const dSigma = B * sinSigma * (cos2SigmaM + (B / 4) * (
        cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
        - (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)
      ));
      return WGS84_B * A * (sigma - dSigma);
    }
  }
  return (sphereM(lat1, lon1, lat2, lon2) / SPHERE_R) * 6371008.8;
};

/**
 * Как считать длины в документе.
 *
 * Новое — по эллипсоиду. Шар остаётся для документов, подписанных до
 * перехода: их пересобирают по постоянной ссылке или в пакете, и
 * «Протяжённость» подписанного листа не должна сдвинуться на 0,3 %
 * задним числом.
 */
export type LengthModel = 'ellipsoid' | 'sphere';

export function metricOf(model: LengthModel | undefined): Metric {
  return model === 'sphere' ? sphereM : ellipsoidM;
}
