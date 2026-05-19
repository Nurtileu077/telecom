import { District, Cable, CableType, CABLE_FIBERS, CABLE_SIZES, InlineJoint } from '@/types/network';

// KML colors are AABBGGRR (alpha, blue, green, red)
const CABLE_STYLES: Record<CableType, { color: string; width: number; label: string }> = {
  'ОК-4':  { color: '8099d499', width: 1.5, label: 'ОК-4 дроп (4 вол.)' },
  'ОК-8':  { color: 'ff80de4a', width: 2,   label: 'ОК-8 абонентский (8 вол.)' },
  'ОК-12': { color: 'fffb923a', width: 2.5, label: 'ОК-12 распределительный (12 вол.)' },
  'ОК-16': { color: 'fffaa560', width: 3,   label: 'ОК-16 распределительный (16 вол.)' },
  'ОК-24': { color: 'ff0b9ef5', width: 3.5, label: 'ОК-24 питающий (24 вол.)' },
  'ОК-32': { color: 'ff24bffb', width: 4,   label: 'ОК-32 питающий (32 вол.)' },
  'ОК-48': { color: 'ff008aec', width: 5,   label: 'ОК-48 магистральный (48 вол.)' },
  'ОК-96': { color: 'ff7171f8', width: 6,   label: 'ОК-96 магистральный (96 вол.)' },
};

const CABLE_ROLE: Record<CableType, string> = {
  'ОК-4':  'Дроп до абонента',
  'ОК-8':  'Абонентский / распределительный',
  'ОК-12': 'Распределительный',
  'ОК-16': 'Распределительный',
  'ОК-24': 'Питающий',
  'ОК-32': 'Питающий',
  'ОК-48': 'Магистральный',
  'ОК-96': 'Магистральный',
};

export type KmzEntityLayer = 'olt' | 'mufta' | 'transitJoint' | 'ork' | 'subscribers' | 'summary';

export interface KmzExportLayers {
  olt: boolean;
  mufta: boolean;
  /** Стыки / транзитные муфты на магистрали (из KML и консолидации). */
  transitJoint: boolean;
  ork: boolean;
  subscribers: boolean;
  summary: boolean;
  cables: Record<CableType, boolean>;
}

export const DEFAULT_KMZ_LAYERS: KmzExportLayers = {
  olt: true,
  mufta: true,
  transitJoint: true,
  ork: true,
  subscribers: true,
  summary: true,
  cables: {
    'ОК-4': true, 'ОК-8': true, 'ОК-12': true, 'ОК-16': true,
    'ОК-24': true, 'ОК-32': true, 'ОК-48': true, 'ОК-96': true,
  },
};

export interface KmzExportOptions {
  layers?: KmzExportLayers;
  /** Транзитные муфты (InlineJoint + импорт KML). */
  joints?: InlineJoint[];
  /** Один общий слой на тип ОК без подпапок по районам (по умолчанию да). */
  flatCableFolders?: boolean;
  documentName?: string;
  /** Только эти типы кабелей (для отдельных файлов ОК-4 / ОК-8 …). */
  onlyCableTypes?: CableType[];
}

interface EntityInfo {
  label: string;
  role: string;
  district: string;
}

const SPECS = {
  olt: `Тип: OLT (Optical Line Terminal)\nМодель: ZTE C300/C320 или Huawei MA5800\nПорты: 8×GPON`,
  tb:  `Тип: Транзитная муфта МТОК-96А\nСплиттер L1: 1:4 или 1:8 (PLC)`,
  ork: `Тип: ОРК / распределительный бокс\nСплиттер L2: 1:8 или 1:16 (PLC)`,
  sub: `Тип: ONT (абонентский терминал)\nМодель: ZTE F601 / Huawei HG8310M`,
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function html(lines: string): string {
  return lines.split('\n').join('<br/>');
}

function isValidLatLng(lat: number, lon: number): boolean {
  return (
    typeof lat === 'number' && typeof lon === 'number' &&
    !isNaN(lat) && !isNaN(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}

function fmt(n: number): string {
  return n.toFixed(6);
}

function fmtLen(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(3)} км` : `${Math.round(m)} м`;
}

function pt(name: string, desc: string, lat: number, lon: number, style: string): string {
  if (!isValidLatLng(lat, lon)) return '';
  return `<Placemark>
  <name>${esc(name)}</name>
  <description><![CDATA[${desc}]]></description>
  <styleUrl>#${style}</styleUrl>
  <Point><coordinates>${fmt(lon)},${fmt(lat)},0</coordinates></Point>
</Placemark>\n`;
}

function line(name: string, coords: [number, number][], style: string, desc = '', extendedData = ''): string {
  const clean: [number, number][] = [];
  for (const c of coords) {
    if (!c || c.length < 2) continue;
    const [la, lo] = c;
    if (!isValidLatLng(la, lo)) continue;
    const prev = clean[clean.length - 1];
    if (prev && Math.abs(prev[0] - la) < 1e-9 && Math.abs(prev[1] - lo) < 1e-9) continue;
    clean.push([la, lo]);
  }
  if (clean.length < 2) return '';
  const cs = clean.map(([lat, lon]) => `${fmt(lon)},${fmt(lat)},0`).join(' ');
  return `<Placemark>
  <name>${esc(name)}</name>
  <description><![CDATA[${desc}]]></description>
  <styleUrl>#${style}</styleUrl>
  ${extendedData}
  <LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${cs}</coordinates></LineString>
</Placemark>\n`;
}

/** Глобальные подписи: Муфта 1, ОРК 2, адрес абонента. */
function buildEntityIndex(districts: District[]): Map<string, EntityInfo> {
  const index = new Map<string, EntityInfo>();
  let globalTb = 0;
  let globalOrk = 0;
  for (const d of districts) {
    index.set(d.olt.id, { label: `OLT · ${d.name}`, role: 'OLT', district: d.name });
    for (const tb of d.olt.transitBoxes) {
      globalTb++;
      index.set(tb.id, {
        label: `Муфта ${globalTb} · ${d.name}`,
        role: 'Муфта МТОК',
        district: d.name,
      });
      for (const ork of tb.orks) {
        globalOrk++;
        index.set(ork.id, {
          label: `ОРК ${globalOrk} (${ork.splitter}) · ${d.name}`,
          role: 'ОРК / бокс',
          district: d.name,
        });
        for (const sub of ork.subscribers) {
          const addr = (sub.desc || 'Абонент').slice(0, 80);
          index.set(sub.id, { label: addr, role: 'Абонент', district: d.name });
        }
      }
    }
    for (const sub of d.subscribers) {
      if (!index.has(sub.id)) {
        const addr = (sub.desc || 'Абонент').slice(0, 80);
        index.set(sub.id, { label: addr, role: 'Абонент', district: d.name });
      }
    }
  }
  return index;
}

function entityLabel(index: Map<string, EntityInfo>, id: string): string {
  return index.get(id)?.label ?? id.replace(/_/g, '-');
}

function allSubscribers(districts: District[]): Array<{ sub: District['subscribers'][0]; district: string; orkId?: string }> {
  const seen = new Set<string>();
  const out: Array<{ sub: District['subscribers'][0]; district: string; orkId?: string }> = [];
  const push = (sub: District['subscribers'][0], district: string, orkId?: string) => {
    if (seen.has(sub.id)) return;
    seen.add(sub.id);
    out.push({ sub, district, orkId });
  };
  for (const d of districts) {
    for (const sub of d.subscribers) push(sub, d.name, sub.orkId);
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        for (const sub of ork.subscribers) push(sub, d.name, ork.id);
      }
    }
  }
  return out;
}

function cablePlacemarkName(cable: Cable, index: Map<string, EntityInfo>): string {
  const from = entityLabel(index, cable.fromId);
  const to = entityLabel(index, cable.toId);
  return `${cable.type} · ${from} → ${to} · ${fmtLen(cable.lengthM)}`;
}

function cableExtendedData(
  cable: Cable,
  index: Map<string, EntityInfo>,
  district: string,
  routed: string,
): string {
  const from = entityLabel(index, cable.fromId);
  const to = entityLabel(index, cable.toId);
  const role = CABLE_ROLE[cable.type];
  const style = CABLE_STYLES[cable.type];
  return `<ExtendedData>
  <SchemaData schemaUrl="#cableSchema">
    <SimpleData name="cableType">${esc(cable.type)}</SimpleData>
    <SimpleData name="fibers">${cable.fibers}</SimpleData>
    <SimpleData name="role">${esc(role)}</SimpleData>
    <SimpleData name="district">${esc(district)}</SimpleData>
    <SimpleData name="from">${esc(from)}</SimpleData>
    <SimpleData name="to">${esc(to)}</SimpleData>
    <SimpleData name="lengthM">${Math.round(cable.lengthM)}</SimpleData>
    <SimpleData name="route">${esc(routed)}</SimpleData>
    <SimpleData name="lineColor">${style.color}</SimpleData>
    <SimpleData name="lineWidth">${style.width}</SimpleData>
  </SchemaData>
</ExtendedData>`;
}

function cableDescription(
  cable: Cable,
  index: Map<string, EntityInfo>,
  district: string,
  routed: string,
): string {
  const from = entityLabel(index, cable.fromId);
  const to = entityLabel(index, cable.toId);
  const role = CABLE_ROLE[cable.type];
  return `<b>${esc(cable.type)} — ${esc(role)}</b><br/>
Район: ${esc(district)}<br/>
Участок: ${esc(from)} → ${esc(to)}<br/>
Длина: ${fmtLen(cable.lengthM)}<br/>
Маршрут: ${routed}`;
}

function kmlStyles(): string {
  return `
<Style id="olt">
  <IconStyle><color>ff14b8f5</color><scale>1.6</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon>
    <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
  </IconStyle>
</Style>
<Style id="tb">
  <IconStyle><color>ff00c8ff</color><scale>1.2</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon>
    <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
  </IconStyle>
</Style>
<Style id="ork">
  <IconStyle><color>ff008aec</color><scale>1.1</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon>
    <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
  </IconStyle>
</Style>
<Style id="sub">
  <IconStyle><color>ff34d399</color><scale>0.55</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
    <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
  </IconStyle>
</Style>
${CABLE_SIZES.map((t) => {
  const s = CABLE_STYLES[t];
  return `<Style id="cable-${t}"><LineStyle><color>${s.color}</color><width>${s.width}</width></LineStyle></Style>`;
}).join('\n')}
`.trim();
}

function enabledCableTypes(layers: KmzExportLayers, only?: CableType[]): CableType[] {
  const base = CABLE_SIZES.filter((t) => layers.cables[t]);
  if (!only || only.length === 0) return base;
  return base.filter((t) => only.includes(t));
}

function emptyCableLayers(): Record<CableType, boolean> {
  return Object.fromEntries(CABLE_SIZES.map((t) => [t, false])) as Record<CableType, boolean>;
}

/** Только один слой объектов, без кабелей. */
export function layersForEntityOnly(entity: KmzEntityLayer): KmzExportLayers {
  return {
    olt: entity === 'olt',
    mufta: entity === 'mufta',
    transitJoint: entity === 'transitJoint',
    ork: entity === 'ork',
    subscribers: entity === 'subscribers',
    summary: entity === 'summary',
    cables: emptyCableLayers(),
  };
}

const ENTITY_EXPORT: Record<KmzEntityLayer, { filename: string; title: string }> = {
  olt: { filename: 'olt', title: 'GPON — OLT — узлы связи' },
  mufta: { filename: 'mufty-mtok', title: 'GPON — Муфты МТОК-96А' },
  transitJoint: { filename: 'transit-mufty', title: 'GPON — Транзитные муфты (магистраль)' },
  ork: { filename: 'ork-boksy', title: 'GPON — ОРК и боксы — общий' },
  subscribers: { filename: 'abonenty', title: 'GPON — Абоненты — общий' },
  summary: { filename: 'svodka-kabely', title: 'GPON — Сводка по кабелям' },
};

export function entityLayerHasContent(
  districts: District[],
  cables: Cable[],
  entity: KmzEntityLayer,
  joints: InlineJoint[] = [],
): boolean {
  if (entity === 'olt') return districts.length > 0;
  if (entity === 'mufta') return districts.some((d) => d.olt.transitBoxes.length > 0);
  if (entity === 'transitJoint') return joints.length > 0;
  if (entity === 'ork') return districts.some((d) => d.olt.transitBoxes.some((tb) => tb.orks.length > 0));
  if (entity === 'subscribers') return allSubscribers(districts).length > 0;
  if (entity === 'summary') return cables.length > 0;
  return false;
}

const ENTITY_LAYER_ORDER: KmzEntityLayer[] = ['olt', 'mufta', 'transitJoint', 'ork', 'subscribers', 'summary'];

/** Собрать KML-документ по выбранным слоям. */
export function buildKmlDocument(
  districts: District[],
  cables: Cable[],
  options: KmzExportOptions = {},
): string {
  const layers = options.layers ?? DEFAULT_KMZ_LAYERS;
  const joints = options.joints ?? [];
  const flatCables = options.flatCableFolders !== false;
  const cableTypes = enabledCableTypes(layers, options.onlyCableTypes);
  const docName = options.documentName ?? `GPON Network — ${new Date().toLocaleDateString('ru')}`;

  const entityIndex = buildEntityIndex(districts);
  const entityDistrict = new Map<string, string>();
  for (const [id, info] of entityIndex.entries()) entityDistrict.set(id, info.district);
  const cableDistrict = (c: Cable): string =>
    entityDistrict.get(c.fromId) ?? entityDistrict.get(c.toId) ?? 'Без района';

  const subs = allSubscribers(districts);
  const totalTbs = districts.reduce((s, d) => s + d.olt.transitBoxes.length, 0);
  const totalOrks = districts.reduce((s, d) => s + d.olt.transitBoxes.reduce((t, tb) => t + tb.orks.length, 0), 0);
  const filteredCables = cables.filter((c) => cableTypes.includes(c.type));
  const totalCableM = filteredCables.reduce((s, c) => s + c.lengthM, 0);

  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${esc(docName)}</name>
<Schema id="cableSchema" name="Кабель ВОЛС">
  <SimpleField name="cableType" type="string"><displayName>Тип кабеля</displayName></SimpleField>
  <SimpleField name="fibers" type="int"><displayName>Волокон</displayName></SimpleField>
  <SimpleField name="district" type="string"><displayName>Район</displayName></SimpleField>
  <SimpleField name="from" type="string"><displayName>От</displayName></SimpleField>
  <SimpleField name="to" type="string"><displayName>До</displayName></SimpleField>
  <SimpleField name="lengthM" type="float"><displayName>Длина, м</displayName></SimpleField>
</Schema>
${kmlStyles()}
`;

  kml += `<description><![CDATA[
<b>GPON — экспорт слоёв</b><br/>
OLT: ${districts.length} · Муфты МТОК: ${totalTbs} · Транзитные муфты: ${joints.length} · ОРК: ${totalOrks} · Абоненты: ${subs.length}<br/>
Кабели в файле: ${filteredCables.length} уч. / ${fmtLen(totalCableM)}<br/>
Дата: ${new Date().toLocaleString('ru')}
]]></description>\n`;

  // ---- Сводка по типам ОК (одна строка на тип в описании папки) ----
  if (layers.summary) {
    let summaryHtml = '<b>Сводка кабелей по типам</b><br/><br/>';
    for (const type of CABLE_SIZES) {
      const typeCables = cables.filter((c) => c.type === type);
      if (typeCables.length === 0) continue;
      const totalM = typeCables.reduce((s, c) => s + c.lengthM, 0);
      summaryHtml += `<b>${esc(type)}</b> — общий: ${typeCables.length} уч., ${fmtLen(totalM)}<br/>`;
      summaryHtml += `${esc(CABLE_ROLE[type])}<br/><br/>`;
    }
    kml += `<Folder><name>📋 Сводка — ОК-4, ОК-8, … (общие длины)</name>
<description><![CDATA[${summaryHtml}]]></description>
</Folder>\n`;
  }

  // ---- OLT ----
  if (layers.olt) {
    kml += `<Folder><name>📡 OLT — узлы связи (${districts.length} шт.)</name>\n`;
    for (const d of districts) {
      const label = entityIndex.get(d.olt.id)?.label ?? `OLT · ${d.name}`;
      const desc = `<b>${esc(label)}</b><br/>Район: ${esc(d.name)}<br/>${html(SPECS.olt)}`;
      kml += pt(label, desc, d.olt.lat, d.olt.lon, 'olt');
    }
    kml += `</Folder>\n`;
  }

  // ---- Муфты (общий слой) ----
  if (layers.mufta) {
    kml += `<Folder><name>🔷 Муфты МТОК — общий (${totalTbs} шт.)</name>\n`;
    for (const d of districts) {
      for (const tb of d.olt.transitBoxes) {
        const label = entityIndex.get(tb.id)?.label ?? tb.id;
        const desc = `<b>${esc(label)}</b><br/>
Район: ${esc(d.name)}<br/>
OLT: ${esc(d.olt.id)}<br/>
Тип: ${esc(tb.muftaType)}<br/>
ОРК: ${tb.orks.length} шт.<br/>
${html(SPECS.tb)}`;
        kml += pt(label, desc, tb.lat, tb.lon, 'tb');
      }
    }
    kml += `</Folder>\n`;
  }

  // ---- Транзитные муфты на магистрали (консолидация + KML) ----
  if (layers.transitJoint && joints.length > 0) {
    kml += `<Folder><name>⊕ Транзитные муфты — общий (${joints.length} шт.)</name>
<description><![CDATA[Стыки и транзитные муфты на магистрали (не МТОК-96 у OLT). Создаются при консолидации или из KML.]]></description>\n`;
    let tjN = 0;
    for (const j of joints) {
      tjN++;
      const label = `Транзитная муфта ${tjN}`;
      const desc = `<b>${esc(label)}</b><br/>
ID: ${esc(j.id)}<br/>
Ответвлений: ${j.branchCount}<br/>
Родитель: ${esc(j.parentId || '—')}<br/>
Тип: транзитная муфта на магистрали`;
      kml += pt(label, desc, j.lat, j.lon, 'tb');
    }
    kml += `</Folder>\n`;
  }

  // ---- ОРК / боксы ----
  if (layers.ork) {
    kml += `<Folder><name>📦 ОРК и боксы — общий (${totalOrks} шт.)</name>\n`;
    for (const d of districts) {
      for (const tb of d.olt.transitBoxes) {
        for (const ork of tb.orks) {
          const label = entityIndex.get(ork.id)?.label ?? ork.id;
          const desc = `<b>${esc(label)}</b><br/>
Район: ${esc(d.name)}<br/>
Муфта: ${esc(entityIndex.get(tb.id)?.label ?? tb.id)}<br/>
Сплиттер: ${esc(ork.splitter)}<br/>
Абонентов: ${ork.subscribers.length}<br/>
${html(SPECS.ork)}`;
          kml += pt(label, desc, ork.lat, ork.lon, 'ork');
        }
      }
    }
    kml += `</Folder>\n`;
  }

  // ---- Абоненты ----
  if (layers.subscribers) {
    kml += `<Folder><name>🏠 Абоненты — общий (${subs.length} шт.)</name>\n`;
    for (const { sub, district, orkId } of subs) {
      const label = entityIndex.get(sub.id)?.label ?? sub.desc;
      const desc = `<b>${esc(label)}</b><br/>
Район: ${esc(district)}<br/>
ОРК: ${esc(orkId ? (entityIndex.get(orkId)?.label ?? orkId) : '—')}<br/>
${html(SPECS.sub)}`;
      kml += pt(label, desc, sub.lat, sub.lon, 'sub');
    }
    kml += `</Folder>\n`;
  }

  // ---- Кабели: один общий слой на тип ОК ----
  let skippedCables = 0;
  for (const type of cableTypes) {
    const typeCables = cables.filter((c) => c.type === type);
    if (typeCables.length === 0) continue;
    const styleInfo = CABLE_STYLES[type];
    const totalTypeM = typeCables.reduce((s, c) => s + c.lengthM, 0);

    kml += `<Folder><name>〰 ${type} — общий · ${typeCables.length} уч. · ${fmtLen(totalTypeM)}</name>
<description><![CDATA[
<b>${esc(type)}</b> — ${esc(CABLE_ROLE[type])}<br/>
Всего участков: ${typeCables.length}<br/>
Суммарная длина: ${fmtLen(totalTypeM)}<br/>
Цвет: ${styleInfo.color} · толщина: ${styleInfo.width}
]]></description>\n`;

    if (!flatCables) {
      const byDist = new Map<string, Cable[]>();
      for (const c of typeCables) {
        const dn = cableDistrict(c);
        if (!byDist.has(dn)) byDist.set(dn, []);
        byDist.get(dn)!.push(c);
      }
      for (const [distName, distCables] of byDist.entries()) {
        kml += `<Folder><name>${esc(distName)} (${distCables.length} уч.)</name>\n`;
        for (const cable of distCables) {
          const routed = cable.routedByOSRM ? '✅ по дороге' : '⚠️ прямая';
          const placemark = line(
            cablePlacemarkName(cable, entityIndex),
            cable.coords,
            `cable-${type}`,
            cableDescription(cable, entityIndex, cableDistrict(cable), routed),
            cableExtendedData(cable, entityIndex, cableDistrict(cable), routed),
          );
          if (!placemark) skippedCables++;
          else kml += placemark;
        }
        kml += `</Folder>\n`;
      }
    } else {
      let segN = 0;
      for (const cable of typeCables) {
        segN++;
        const routed = cable.routedByOSRM ? '✅ по дороге' : '⚠️ прямая';
        const placemark = line(
          cablePlacemarkName(cable, entityIndex),
          cable.coords,
          `cable-${type}`,
          cableDescription(cable, entityIndex, cableDistrict(cable), routed)
            + `<br/><i>№${segN} из ${typeCables.length}</i>`,
          cableExtendedData(cable, entityIndex, cableDistrict(cable), routed),
        );
        if (!placemark) skippedCables++;
        else kml += placemark;
      }
    }
    kml += `</Folder>\n`;
  }

  if (skippedCables > 0) {
    console.warn(`[KMZ] Пропущено ${skippedCables} кабелей с битыми координатами`);
  }

  kml += `</Document></kml>`;
  return kml;
}

export async function kmlToKmzBlob(kml: string): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

export async function exportKMZ(
  districts: District[],
  cables: Cable[],
  options: KmzExportOptions = {},
): Promise<Blob> {
  const kml = buildKmlDocument(districts, cables, options);
  return kmlToKmzBlob(kml);
}

/** Отдельный KMZ только с одним типом кабеля (без OLT/муфт/ОРК). */
export async function exportKMZForCableType(
  districts: District[],
  cables: Cable[],
  type: CableType,
): Promise<Blob> {
  const cableLayers: KmzExportLayers = {
    olt: false,
    mufta: false,
    transitJoint: false,
    ork: false,
    subscribers: false,
    summary: false,
    cables: { ...emptyCableLayers(), [type]: true },
  };
  return exportKMZ(districts, cables, {
    layers: cableLayers,
    onlyCableTypes: [type],
    documentName: `GPON — ${type} — общий`,
    flatCableFolders: true,
  });
}

/** Отдельный KMZ только с одним слоём объектов (OLT / муфты / ОРК / абоненты / сводка). */
export async function exportKMZForEntityLayer(
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[],
  entity: KmzEntityLayer,
): Promise<Blob> {
  const meta = ENTITY_EXPORT[entity];
  return exportKMZ(districts, cables, {
    layers: layersForEntityOnly(entity),
    joints,
    documentName: meta.title,
    flatCableFolders: true,
  });
}

export type KmzPackageMode = 'full-only' | 'split-by-type' | 'full-and-split';

async function addKmzToZip(zip: { file: (name: string, data: ArrayBuffer) => void }, path: string, kml: string) {
  const buf = await (await kmlToKmzBlob(kml)).arrayBuffer();
  zip.file(path, buf);
}

/** ZIP: общий KMZ + отдельные файлы по объектам и по типам ОК. */
export async function exportKMZPackage(
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[],
  layers: KmzExportLayers,
  mode: KmzPackageMode,
): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const types = enabledCableTypes(layers).filter((t) => cables.some((c) => c.type === t));

  if (mode === 'full-only' || mode === 'full-and-split') {
    const fullKml = buildKmlDocument(districts, cables, { layers, joints, flatCableFolders: true });
    await addKmzToZip(zip, 'gpon-network.kmz', fullKml);
  }

  if (mode === 'split-by-type' || mode === 'full-and-split') {
    for (const entity of ENTITY_LAYER_ORDER) {
      if (!layers[entity]) continue;
      if (!entityLayerHasContent(districts, cables, entity, joints)) continue;
      const kml = buildKmlDocument(districts, cables, {
        layers: layersForEntityOnly(entity),
        joints,
        documentName: ENTITY_EXPORT[entity].title,
        flatCableFolders: true,
      });
      await addKmzToZip(zip, `objects/gpon-${ENTITY_EXPORT[entity].filename}.kmz`, kml);
    }
    for (const type of types) {
      const kml = buildKmlDocument(districts, cables, {
        layers: {
          olt: false, mufta: false, transitJoint: false, ork: false, subscribers: false, summary: false,
          cables: { ...emptyCableLayers(), [type]: true },
        },
        joints,
        onlyCableTypes: [type],
        documentName: `GPON — ${type}`,
        flatCableFolders: true,
      });
      await addKmzToZip(zip, `cables/gpon-${type.toLowerCase()}.kmz`, kml);
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

async function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  await new Promise((r) => setTimeout(r, 280));
}

/** Отдельные KMZ: OLT, муфты, ОРК, абоненты, сводка. */
export async function downloadKMZSplitByEntity(
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[],
  layers: KmzExportLayers,
  filenamePrefix: string,
): Promise<void> {
  for (const entity of ENTITY_LAYER_ORDER) {
    if (!layers[entity]) continue;
    if (!entityLayerHasContent(districts, cables, entity, joints)) continue;
    const blob = await exportKMZForEntityLayer(districts, cables, joints, entity);
    await triggerDownload(blob, `${filenamePrefix}-${ENTITY_EXPORT[entity].filename}.kmz`);
  }
}

/** Отдельные KMZ по типам ОК. */
export async function downloadKMZSplitByType(
  districts: District[],
  cables: Cable[],
  layers: KmzExportLayers,
  filenamePrefix: string,
): Promise<void> {
  const types = enabledCableTypes(layers).filter((t) => cables.some((c) => c.type === t));
  for (const type of types) {
    const blob = await exportKMZForCableType(districts, cables, type);
    await triggerDownload(blob, `${filenamePrefix}-${type.toLowerCase()}.kmz`);
  }
}

/** Все отдельные файлы: объекты + кабели. */
export async function downloadKMZSplitAll(
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[],
  layers: KmzExportLayers,
  filenamePrefix: string,
): Promise<void> {
  await downloadKMZSplitByEntity(districts, cables, joints, layers, filenamePrefix);
  await downloadKMZSplitByType(districts, cables, layers, filenamePrefix);
}
