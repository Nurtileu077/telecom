import { District, Cable } from '@/types/network';

// KML colors are AABBGGRR (alpha, blue, green, red)
const CABLE_STYLES: Record<string, { color: string; width: number; label: string }> = {
  'ОК-4':  { color: '8099d499', width: 1.5, label: 'ОК-4 дроп (4 вол.)' },
  'ОК-8':  { color: 'ff80de4a', width: 2,   label: 'ОК-8 абонентский (8 вол.)' },
  'ОК-12': { color: 'fffb923a', width: 2.5, label: 'ОК-12 распределительный (12 вол.)' },
  'ОК-16': { color: 'fffaa560', width: 3,   label: 'ОК-16 распределительный (16 вол.)' },
  'ОК-24': { color: 'ff0b9ef5', width: 3.5, label: 'ОК-24 питающий (24 вол.)' },
  'ОК-32': { color: 'ff24bffb', width: 4,   label: 'ОК-32 питающий (32 вол.)' },
  'ОК-48': { color: 'ff008aec', width: 5,   label: 'ОК-48 магистральный (48 вол.)' },
  'ОК-96': { color: 'ff7171f8', width: 6,   label: 'ОК-96 магистральный (96 вол.)' },
};

// Material specs per item type
const SPECS = {
  olt: `Тип: OLT (Optical Line Terminal)\nМодель: ZTE C300/C320 или Huawei MA5800\nПорты: 8×GPON\nМощность TX: +3 дБм\nВолокон: 64–128 або. на порт`,
  tb:  `Тип: Транзитная муфта МТОК-96А\nВолокон: 96\nСплиттер L1: 1:4 или 1:8 (PLC)\nПигтейл: SC/APC`,
  ork: `Тип: ОРК (оптический распределительный кабинет)\nВолокон: 8–16\nСплиттер L2: 1:8 или 1:16 (PLC)\nПодключение: SC/APC адаптер`,
  sub: `Тип: ONT (Optical Network Terminal)\nМодель: ZTE F601/F609 или HUAWEI HG8310M\nРазъём: SC/APC`,
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
  // 6 decimal places ≈ 11 cm precision — more than enough, keeps KML small.
  return n.toFixed(6);
}

// ExtendedData → структурированные атрибуты (Длина, Тип, От, До…). В отличие от
// HTML-описания они подхватываются как поля в Google Earth/My Maps/QGIS сразу,
// поэтому метраж виден без редактирования метки.
function dataXml(ext?: Record<string, string | number>): string {
  if (!ext) return '';
  const rows = Object.entries(ext)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `    <Data name="${esc(k)}"><value>${esc(String(v))}</value></Data>`)
    .join('\n');
  if (!rows) return '';
  return `\n  <ExtendedData>\n${rows}\n  </ExtendedData>`;
}

function pt(name: string, desc: string, lat: number, lon: number, style: string, ext?: Record<string, string | number>): string {
  if (!isValidLatLng(lat, lon)) return '';
  return `<Placemark>
  <name>${esc(name)}</name>
  <description><![CDATA[${desc}]]></description>
  <styleUrl>#${style}</styleUrl>${dataXml(ext)}
  <Point><coordinates>${fmt(lon)},${fmt(lat)},0</coordinates></Point>
</Placemark>\n`;
}

function line(name: string, coords: [number, number][], style: string, desc = '', ext?: Record<string, string | number>): string {
  // Filter NaN / out-of-range pairs; collapse adjacent duplicates so Google Maps
  // doesn't reject the LineString as degenerate.
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
  <styleUrl>#${style}</styleUrl>${dataXml(ext)}
  <LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${cs}</coordinates></LineString>
</Placemark>\n`;
}

function fmtLen(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(3)} км` : `${Math.round(m)} м`;
}

// Слои экспорта — пользователь может выбрать какие включать и одним файлом или
// по отдельности (каждый слой = свой .kmz внутри zip).
export type KmzLayer = 'olt' | 'tb' | 'ork' | 'sub' | 'cables';
export const ALL_LAYERS: KmzLayer[] = ['olt', 'tb', 'ork', 'sub', 'cables'];
export const LAYER_LABEL: Record<KmzLayer, string> = {
  olt: 'OLT', tb: 'Муфты', ork: 'ОРКСП', sub: 'Камеры', cables: 'Кабели',
};
// ASCII-имена для файлов внутри zip — кириллица в именах архива бьётся на Windows.
const LAYER_FILE: Record<KmzLayer, string> = {
  olt: 'OLT', tb: 'mufty', ork: 'orksp', sub: 'kamery', cables: 'kabeli',
};

export interface KmzExportOpts {
  layers?: KmzLayer[];   // какие слои включать (по умолчанию все)
  separate?: boolean;    // true → zip из отдельных .kmz по слоям
}

export async function exportKMZ(districts: District[], cables: Cable[], opts?: KmzExportOpts): Promise<Blob> {
  const JSZip = (await import('jszip')).default;

  // ---- Styles ----
  // hotSpot x=0.5 y=0.5 → центр-якорь иконки лежит точно на координатах,
  // иначе Google Earth/Maps крепят png за левый-нижний угол и метки смещены.
  const styles = `
<Style id="olt">
  <IconStyle><color>ff14b8f5</color><scale>1.6</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon>
    <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
  </IconStyle>
  <LabelStyle><color>ff14b8f5</color><scale>0.9</scale></LabelStyle>
</Style>
<Style id="tb">
  <IconStyle><color>ff00c8ff</color><scale>1.2</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon>
    <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
  </IconStyle>
  <LabelStyle><color>ff00c8ff</color><scale>0.7</scale></LabelStyle>
</Style>
<Style id="ork">
  <IconStyle><color>ff008aec</color><scale>1.1</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon>
    <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
  </IconStyle>
  <LabelStyle><color>ff008aec</color><scale>0.65</scale></LabelStyle>
</Style>
<Style id="sub">
  <IconStyle><color>ff34d399</color><scale>0.55</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
    <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
  </IconStyle>
  <LabelStyle><scale>0</scale></LabelStyle>
</Style>
${Object.entries(CABLE_STYLES).map(([t, s]) =>
  `<Style id="cable-${t}"><LineStyle><color>${s.color}</color><width>${s.width}</width></LineStyle></Style>`,
).join('\n')}
`.trim();

  // Summary stats
  const totalSubs = districts.reduce((s, d) => s + d.subscribers.length, 0);
  const totalOrks = districts.reduce((s, d) => s + d.olt.transitBoxes.reduce((t, tb) => t + tb.orks.length, 0), 0);
  const totalTbs  = districts.reduce((s, d) => s + d.olt.transitBoxes.length, 0);
  const totalCableM = cables.reduce((s, c) => s + c.lengthM, 0);
  const routedCount = cables.filter((c) => c.routedByOSRM).length;

  const summaryCDATA = `<description><![CDATA[
<b>OPTIQ — проект сети</b><br/>
Районов: ${districts.length}<br/>
Абонентов: ${totalSubs}<br/>
OLT: ${districts.length}<br/>
Транзитных муфт: ${totalTbs}<br/>
ОРК шкафов: ${totalOrks}<br/>
Кабелей всего: ${cables.length} сегм. / ${fmtLen(totalCableM)}<br/>
Проложено по дороге: ${routedCount} из ${cables.length} сегм.<br/>
Дата: ${new Date().toLocaleString('ru')}
]]></description>\n`;

  // ---- Per-layer folder builders (so export can be combined / by-layer) ----
  const buildOlt = (): string => {
    let s = `<Folder><name>📡 OLT — Узлы связи (${districts.length} шт.)</name>\n`;
    for (const d of districts) {
      const desc = `<b>${esc(d.olt.id)}</b><br/>
Район: ${esc(d.name)}<br/>
${html(SPECS.olt)}<br/>
<br/>
<b>Статистика:</b><br/>
Транзитных муфт: ${d.olt.transitBoxes.length}<br/>
ОРК шкафов: ${d.olt.transitBoxes.reduce((a, tb) => a + tb.orks.length, 0)}<br/>
Абонентов: ${d.subscribers.length}`;
      s += pt(d.olt.id, desc, d.olt.lat, d.olt.lon, 'olt', {
        'Тип': 'OLT',
        'Район': d.name,
        'Муфт': d.olt.transitBoxes.length,
        'ОРКСП': d.olt.transitBoxes.reduce((a, tb) => a + tb.orks.length, 0),
        'Камер': d.subscribers.length,
      });
    }
    return s + `</Folder>\n`;
  };

  const buildTb = (): string => {
    let s = `<Folder><name>🔷 Транзитные муфты (${totalTbs} шт.)</name>\n`;
    for (const d of districts) {
      if (d.olt.transitBoxes.length === 0) continue;
      s += `<Folder><name>${esc(d.name)}</name>\n`;
      for (const tb of d.olt.transitBoxes) {
        const desc = `<b>${esc(tb.id)}</b><br/>
Район: ${esc(d.name)}<br/>
OLT: ${esc(d.olt.id)}<br/>
Муфта: ${esc(tb.muftaType)}<br/>
ОРК подключено: ${tb.orks.length}<br/>
<br/>
${html(SPECS.tb)}`;
        s += pt(tb.id, desc, tb.lat, tb.lon, 'tb', {
          'Тип': 'Транзитная муфта',
          'Район': d.name,
          'OLT': d.olt.id,
          'Муфта': tb.muftaType,
          'ОРКСП': tb.orks.length,
        });
      }
      s += `</Folder>\n`;
    }
    return s + `</Folder>\n`;
  };

  const buildOrk = (): string => {
    let s = `<Folder><name>📦 ОРКСП шкафы (${totalOrks} шт.)</name>\n`;
    for (const d of districts) {
      s += `<Folder><name>${esc(d.name)}</name>\n`;
      for (const tb of d.olt.transitBoxes) {
        for (const ork of tb.orks) {
          const desc = `<b>${esc(ork.id)}</b><br/>
Район: ${esc(d.name)}<br/>
Транзитная муфта: ${esc(tb.id)}<br/>
Сплиттер: PLC ${esc(ork.splitter)}<br/>
Абонентов: ${ork.subscribers.length}<br/>
<br/>
${html(SPECS.ork)}`;
          s += pt(ork.id, desc, ork.lat, ork.lon, 'ork', {
            'Тип': 'ОРКСП',
            'Район': d.name,
            'Муфта': tb.id,
            'Сплиттер': ork.splitter,
            'Камер': ork.subscribers.length,
          });
        }
      }
      s += `</Folder>\n`;
    }
    return s + `</Folder>\n`;
  };

  const buildSub = (): string => {
    let s = `<Folder><name>🏠 Камеры (${totalSubs} шт.)</name>\n`;
    for (const d of districts) {
      s += `<Folder><name>${esc(d.name)} (${d.subscribers.length} шт.)</name>\n`;
      for (const sub of d.subscribers) {
        const ork = d.olt.transitBoxes.flatMap((tb) => tb.orks).find((o) => o.id === sub.orkId);
        const desc = `<b>${esc(sub.desc)}</b><br/>
Район: ${esc(d.name)}<br/>
ОРК: ${esc(sub.orkId || '—')}<br/>
Сплиттер: ${ork ? esc(ork.splitter) : '—'}<br/>
Волокна: ${sub.fibers.working} раб. + ${sub.fibers.spare} зап.<br/>
<br/>
${html(SPECS.sub)}`;
        s += pt(`${sub.desc}`, desc, sub.lat, sub.lon, 'sub', {
          'Тип': 'Камера',
          'Район': d.name,
          'ОРКСП': sub.orkId || '',
          'Сплиттер': ork ? ork.splitter : '',
          'Волокна': `${sub.fibers.working}+${sub.fibers.spare}`,
        });
      }
      s += `</Folder>\n`;
    }
    return s + `</Folder>\n`;
  };

  // ---- Cables — split by type then by district  ----
  // Google My Maps imposes 2000 features per layer; each <Folder> at top level
  // becomes one layer.  Per-type only would put e.g. 2000+ drops in one layer
  // and silently truncate.  Per-(type×district) keeps every folder well below
  // the limit and matches the entity-folder convention.
  const cableTypeOrder: Cable['type'][] = ['ОК-4', 'ОК-8', 'ОК-12', 'ОК-16', 'ОК-24', 'ОК-32', 'ОК-48', 'ОК-96'];

  // Build district → entity-id  index so we can attribute cables.  An ORK belongs
  // to district X if it shows up under X's OLT; subscriber too.  Cables that
  // can't be attributed (joints span districts) fall into a "Без района" bucket.
  const entityDistrict = new Map<string, string>();
  for (const d of districts) {
    entityDistrict.set(d.olt.id, d.name);
    for (const tb of d.olt.transitBoxes) {
      entityDistrict.set(tb.id, d.name);
      for (const ork of tb.orks) {
        entityDistrict.set(ork.id, d.name);
        for (const sub of ork.subscribers) entityDistrict.set(sub.id, d.name);
      }
    }
    for (const sub of d.subscribers) entityDistrict.set(sub.id, d.name);
  }
  const cableDistrict = (c: Cable): string =>
    entityDistrict.get(c.fromId) ?? entityDistrict.get(c.toId) ?? 'Без района';

  const buildCables = (): string => {
    let s = '';
    let skippedCables = 0;
    for (const type of cableTypeOrder) {
      const typeCables = cables.filter((c) => c.type === type);
      if (typeCables.length === 0) continue;
      const styleInfo = CABLE_STYLES[type];
      const totalTypeM = typeCables.reduce((a, c) => a + c.lengthM, 0);

      const byDist = new Map<string, Cable[]>();
      for (const c of typeCables) {
        const dn = cableDistrict(c);
        if (!byDist.has(dn)) byDist.set(dn, []);
        byDist.get(dn)!.push(c);
      }

      s += `<Folder><name>${styleInfo.label} — ${typeCables.length} уч. / ${fmtLen(totalTypeM)}</name>\n`;
      for (const [distName, distCables] of byDist.entries()) {
        s += `<Folder><name>${esc(distName)} (${distCables.length} уч.)</name>\n`;
        for (const cable of distCables) {
          const routed = cable.routedByOSRM ? '✅ по дороге (OSRM)' : '⚠️ прямая линия';
          const lenM = Math.round(cable.lengthM);
          const desc = `<b>${esc(cable.fromId)} → ${esc(cable.toId)}</b><br/>
Тип: ${esc(cable.type)}<br/>
Длина: ${fmtLen(cable.lengthM)}<br/>
Маршрут: ${routed}<br/>
Точек: ${cable.coords.length}`;
          // Метраж в НАЗВАНИЕ + в ExtendedData, чтобы он был виден сразу при
          // загрузке (а не только в описании после редактирования).
          const cableName = `${cable.type} · ${fmtLen(cable.lengthM)} · ${cable.fromId}→${cable.toId}`;
          const ext = {
            'Тип': cable.type,
            'Длина_м': lenM,
            'Длина': fmtLen(cable.lengthM),
            'Жил': cable.fibers,
            'От': cable.fromId,
            'До': cable.toId,
            'Маршрут': cable.routedByOSRM ? 'OSRM' : 'прямая',
          };
          const placemark = line(cableName, cable.coords, `cable-${type}`, desc, ext);
          if (!placemark) { skippedCables++; continue; }
          s += placemark;
        }
        s += `</Folder>\n`;
      }
      s += `</Folder>\n`;
    }
    if (skippedCables > 0) console.warn(`[KMZ] Пропущено ${skippedCables} кабелей с битыми координатами`);
    return s;
  };

  // ---- Assemble document(s) per options ----
  const builders: Record<KmzLayer, () => string> = {
    olt: buildOlt, tb: buildTb, ork: buildOrk, sub: buildSub, cables: buildCables,
  };
  const want = opts?.layers && opts.layers.length ? opts.layers : ALL_LAYERS;
  const selected = ALL_LAYERS.filter((l) => want.includes(l));

  const wrapDoc = (title: string, body: string, withSummary: boolean): string =>
    `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${esc(title)}</name>
${styles}
${withSummary ? summaryCDATA : ''}${body}</Document></kml>`;

  const date = new Date().toLocaleDateString('ru');

  if (opts?.separate) {
    // Каждый слой — отдельный .kmz внутри одного .zip (готово к раздаче).
    const outer = new JSZip();
    for (const layer of selected) {
      const kml = wrapDoc(`OPTIQ — ${LAYER_LABEL[layer]} (${date})`, builders[layer](), false);
      const inner = new JSZip();
      inner.file('doc.kml', kml);
      const kmz = await inner.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
      outer.file(`OPTIQ-${LAYER_FILE[layer]}.kmz`, kmz);
    }
    return outer.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  }

  const kml = wrapDoc(`OPTIQ — ${date}`, selected.map((l) => builders[l]()).join(''), true);
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
