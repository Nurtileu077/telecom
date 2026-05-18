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

function pt(name: string, desc: string, lat: number, lon: number, style: string): string {
  if (!isValidLatLng(lat, lon)) return '';
  return `<Placemark>
  <name>${esc(name)}</name>
  <description><![CDATA[${desc}]]></description>
  <styleUrl>#${style}</styleUrl>
  <Point><coordinates>${fmt(lon)},${fmt(lat)},0</coordinates></Point>
</Placemark>\n`;
}

function line(name: string, coords: [number, number][], style: string, desc = ''): string {
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
  <styleUrl>#${style}</styleUrl>
  <LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${cs}</coordinates></LineString>
</Placemark>\n`;
}

function fmtLen(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(3)} км` : `${Math.round(m)} м`;
}

export async function exportKMZ(districts: District[], cables: Cable[]): Promise<Blob> {
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

  // ---- KML body ----
  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>GPON Network — ${new Date().toLocaleDateString('ru')}</name>
${styles}
`;

  // Summary stats
  const totalSubs = districts.reduce((s, d) => s + d.subscribers.length, 0);
  const totalOrks = districts.reduce((s, d) => s + d.olt.transitBoxes.reduce((t, tb) => t + tb.orks.length, 0), 0);
  const totalTbs  = districts.reduce((s, d) => s + d.olt.transitBoxes.length, 0);
  const totalCableM = cables.reduce((s, c) => s + c.lengthM, 0);
  const routedCount = cables.filter((c) => c.routedByOSRM).length;

  kml += `<description><![CDATA[
<b>GPON Проект</b><br/>
Районов: ${districts.length}<br/>
Абонентов: ${totalSubs}<br/>
OLT: ${districts.length}<br/>
Транзитных муфт МТОК-96А: ${totalTbs}<br/>
ОРК шкафов: ${totalOrks}<br/>
Кабелей всего: ${cables.length} сегм. / ${fmtLen(totalCableM)}<br/>
Проложено по дороге: ${routedCount} из ${cables.length} сегм.<br/>
Дата: ${new Date().toLocaleString('ru')}
]]></description>\n`;

  // ---- OLT ----
  kml += `<Folder><name>📡 OLT — Узлы связи (${districts.length} шт.)</name>\n`;
  for (const d of districts) {
    const desc = `<b>${esc(d.olt.id)}</b><br/>
Район: ${esc(d.name)}<br/>
${html(SPECS.olt)}<br/>
<br/>
<b>Статистика:</b><br/>
Транзитных муфт: ${d.olt.transitBoxes.length}<br/>
ОРК шкафов: ${d.olt.transitBoxes.reduce((s, tb) => s + tb.orks.length, 0)}<br/>
Абонентов: ${d.subscribers.length}`;
    kml += pt(d.olt.id, desc, d.olt.lat, d.olt.lon, 'olt');
  }
  kml += `</Folder>\n`;

  // ---- Transit Boxes ----
  kml += `<Folder><name>🔷 Транзитные муфты МТОК-96А (${totalTbs} шт.)</name>\n`;
  for (const d of districts) {
    if (d.olt.transitBoxes.length === 0) continue;
    kml += `<Folder><name>${esc(d.name)}</name>\n`;
    for (const tb of d.olt.transitBoxes) {
      const desc = `<b>${esc(tb.id)}</b><br/>
Район: ${esc(d.name)}<br/>
OLT: ${esc(d.olt.id)}<br/>
Муфта: ${esc(tb.muftaType)}<br/>
ОРК подключено: ${tb.orks.length}<br/>
<br/>
${html(SPECS.tb)}`;
      kml += pt(tb.id, desc, tb.lat, tb.lon, 'tb');
    }
    kml += `</Folder>\n`;
  }
  kml += `</Folder>\n`;

  // ---- ORK ----
  kml += `<Folder><name>📦 ОРК шкафы (${totalOrks} шт.)</name>\n`;
  for (const d of districts) {
    kml += `<Folder><name>${esc(d.name)}</name>\n`;
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        const desc = `<b>${esc(ork.id)}</b><br/>
Район: ${esc(d.name)}<br/>
Транзитная муфта: ${esc(tb.id)}<br/>
Сплиттер: PLC ${esc(ork.splitter)}<br/>
Абонентов: ${ork.subscribers.length}<br/>
<br/>
${html(SPECS.ork)}`;
        kml += pt(ork.id, desc, ork.lat, ork.lon, 'ork');
      }
    }
    kml += `</Folder>\n`;
  }
  kml += `</Folder>\n`;

  // ---- Subscribers ----
  kml += `<Folder><name>🏠 Абоненты (${totalSubs} або.)</name>\n`;
  for (const d of districts) {
    kml += `<Folder><name>${esc(d.name)} (${d.subscribers.length} або.)</name>\n`;
    for (const sub of d.subscribers) {
      const ork = d.olt.transitBoxes.flatMap((tb) => tb.orks).find((o) => o.id === sub.orkId);
      const desc = `<b>${esc(sub.desc)}</b><br/>
Район: ${esc(d.name)}<br/>
ОРК: ${esc(sub.orkId || '—')}<br/>
Сплиттер: ${ork ? esc(ork.splitter) : '—'}<br/>
Волокна: ${sub.fibers.working} раб. + ${sub.fibers.spare} зап.<br/>
<br/>
${html(SPECS.sub)}`;
      kml += pt(`${sub.desc}`, desc, sub.lat, sub.lon, 'sub');
    }
    kml += `</Folder>\n`;
  }
  kml += `</Folder>\n`;

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

  let skippedCables = 0;
  for (const type of cableTypeOrder) {
    const typeCables = cables.filter((c) => c.type === type);
    if (typeCables.length === 0) continue;
    const styleInfo = CABLE_STYLES[type];
    const totalTypeM = typeCables.reduce((s, c) => s + c.lengthM, 0);

    // Group by district
    const byDist = new Map<string, Cable[]>();
    for (const c of typeCables) {
      const dn = cableDistrict(c);
      if (!byDist.has(dn)) byDist.set(dn, []);
      byDist.get(dn)!.push(c);
    }

    kml += `<Folder><name>${styleInfo.label} — ${typeCables.length} уч. / ${fmtLen(totalTypeM)}</name>\n`;
    for (const [distName, distCables] of byDist.entries()) {
      kml += `<Folder><name>${esc(distName)} (${distCables.length} уч.)</name>\n`;
      for (const cable of distCables) {
        const routed = cable.routedByOSRM ? '✅ по дороге (OSRM)' : '⚠️ прямая линия';
        const desc = `<b>${esc(cable.fromId)} → ${esc(cable.toId)}</b><br/>
Тип: ${esc(cable.type)}<br/>
Длина: ${fmtLen(cable.lengthM)}<br/>
Маршрут: ${routed}<br/>
Точек: ${cable.coords.length}`;
        const placemark = line(`${cable.fromId}→${cable.toId}`, cable.coords, `cable-${type}`, desc);
        if (!placemark) { skippedCables++; continue; }
        kml += placemark;
      }
      kml += `</Folder>\n`;
    }
    kml += `</Folder>\n`;
  }

  if (skippedCables > 0) {
    console.warn(`[KMZ] Пропущено ${skippedCables} кабелей с битыми координатами`);
  }

  kml += `</Document></kml>`;

  const zip = new JSZip();
  zip.file('doc.kml', kml);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
