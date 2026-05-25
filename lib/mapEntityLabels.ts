import type { District } from '@/types/network';

/** Короткие подписи узлов на карте (как в KMZ: Муфта 1, ОРК 2, район). */
export function mapLabelForOlt(district: District): string {
  const short = district.name.length > 28 ? `${district.name.slice(0, 26)}…` : district.name;
  return `OLT · ${short}`;
}

export function mapLabelForTb(district: District, tbIndex: number, muftaType?: string): string {
  const m = muftaType ? ` ${muftaType}` : '';
  return `Муфта ${tbIndex}${m}`;
}

export function mapLabelForOrk(district: District, orkIndex: number, splitter: string): string {
  return `ОРК ${orkIndex} · ${splitter}`;
}

export function buildMapEntityLabels(districts: District[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const d of districts) {
    labels.set(d.olt.id, mapLabelForOlt(d));
    let tbN = 0;
    for (const tb of d.olt.transitBoxes) {
      tbN++;
      labels.set(tb.id, mapLabelForTb(d, tbN, tb.muftaType));
      let orkN = 0;
      for (const ork of tb.orks) {
        orkN++;
        labels.set(ork.id, mapLabelForOrk(d, orkN, ork.splitter));
      }
    }
  }
  return labels;
}
