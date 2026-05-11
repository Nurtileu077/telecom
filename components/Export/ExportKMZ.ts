import { District, Cable } from '@/types/network';

// KML colors are AABBGGRR (alpha, blue, green, red)
const CABLE_STYLES: Record<string, { color: string; width: number; label: string }> = {
  'ОКБ-10':  { color: 'fffc00d4', width: 5,   label: 'ОКБ-10 магистраль (8 вол.)' },
  'ОКСНН-8': { color: 'ff008aec', width: 3.5,  label: 'ОКСНН-8 распределительный (8 вол.)' },
  'ОКСНН-4': { color: 'ffFB923A', width: 2.5,  label: 'ОКСНН-4 питающий (4 вол.)' },
  'ОКА-2':   { color: '8099d499', width: 1.5,  label: 'ОКА-2 дроп абонентский (2 вол.)' },
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

function pt(name: string, desc: string, lat: number, lon: number, style: string): string {
  return `<Placemark>
  <name>${esc(name)}</name>
  <description><![CDATA[${desc}]]></description>
  <styleUrl>#${style}</styleUrl>
  <Point><coordinates>${lon},${lat},0</coordinates></Point>
</Placemark>\n`;
}

function line(name: string, coords: [number, number][], style: string, desc = ''): string {
  const cs = coords.map(([lat, lon]) => `${lon},${lat},0`).join(' ');
  return `<Placemark>
  <name>${esc(name)}</name>
  <description><![CDATA[${desc}]]></description>
  <styleUrl>#${style}</styleUrl>
  <LineString><tessellate>1</tessellate><coordinates>${cs}</coordinates></LineString>
</Placemark>\n`;
}

function fmtLen(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(3)} км` : `${Math.round(m)} м`;
}

export async function exportKMZ(districts: District[], cables: Cable[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;

  // ---- Styles ----
  const styles = `
<Style id="olt">
  <IconStyle><color>ff14b8f5</color><scale>1.6</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon>
  </IconStyle>
  <LabelStyle><color>ff14b8f5</color><scale>0.9</scale></LabelStyle>
</Style>
<Style id="tb">
  <IconStyle><color>ff00c8ff</color><scale>1.2</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon>
  </IconStyle>
  <LabelStyle><color>ff00c8ff</color><scale>0.7</scale></LabelStyle>
</Style>
<Style id="ork">
  <IconStyle><color>ff008aec</color><scale>1.1</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon>
  </IconStyle>
  <LabelStyle><color>ff008aec</color><scale>0.65</scale></LabelStyle>
</Style>
<Style id="sub">
  <IconStyle><color>ff34d399</color><scale>0.55</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
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

  // ---- Cables by type ----
  const cableTypeOrder: Cable['type'][] = ['ОКБ-10', 'ОКСНН-8', 'ОКСНН-4', 'ОКА-2'];
  for (const type of cableTypeOrder) {
    const typeCables = cables.filter((c) => c.type === type);
    if (typeCables.length === 0) continue;
    const styleInfo = CABLE_STYLES[type];
    const totalTypeM = typeCables.reduce((s, c) => s + c.lengthM, 0);
    kml += `<Folder><name>${styleInfo.label} — ${typeCables.length} уч. / ${fmtLen(totalTypeM)}</name>\n`;
    for (const cable of typeCables) {
      const routed = cable.routedByOSRM ? '✅ по дороге (OSRM)' : '⚠️ прямая линия';
      const desc = `<b>${esc(cable.fromId)} → ${esc(cable.toId)}</b><br/>
Тип: ${esc(cable.type)}<br/>
Длина: ${fmtLen(cable.lengthM)}<br/>
Маршрут: ${routed}<br/>
Точек: ${cable.coords.length}`;
      kml += line(`${cable.fromId}→${cable.toId}`, cable.coords, `cable-${type}`, desc);
    }
    kml += `</Folder>\n`;
  }

  kml += `</Document></kml>`;

  const zip = new JSZip();
  zip.file('doc.kml', kml);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
