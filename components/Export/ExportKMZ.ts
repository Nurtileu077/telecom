import { District, Cable } from '@/types/network';

const CABLE_STYLES: Record<string, { color: string; width: number }> = {
  'ОКБ-10':   { color: 'ff00d4fc', width: 5 },
  'ОКСНН-8':  { color: 'ffec8a00', width: 3.5 },
  'ОКСНН-4':  { color: 'ff3a92fb', width: 2.5 },
  'ОКА-2':    { color: '8099d499', width: 1.5 },
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function placemark(name: string, desc: string, lat: number, lon: number, styleUrl: string): string {
  return `<Placemark>
  <name>${escapeXml(name)}</name>
  <description><![CDATA[${desc}]]></description>
  <styleUrl>#${styleUrl}</styleUrl>
  <Point><coordinates>${lon},${lat},0</coordinates></Point>
</Placemark>`;
}

function linePlacemark(name: string, coords: [number, number][], styleUrl: string, desc = ''): string {
  const coordStr = coords.map(([lat, lon]) => `${lon},${lat},0`).join(' ');
  return `<Placemark>
  <name>${escapeXml(name)}</name>
  <description><![CDATA[${desc}]]></description>
  <styleUrl>#${styleUrl}</styleUrl>
  <LineString><tessellate>1</tessellate><coordinates>${coordStr}</coordinates></LineString>
</Placemark>`;
}

export async function exportKMZ(districts: District[], cables: Cable[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;

  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>GPON Network</name>
<Style id="olt"><IconStyle><color>ff00d4fc</color><scale>1.5</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon></IconStyle></Style>
<Style id="tb"><IconStyle><color>ffec8a00</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon></IconStyle></Style>
<Style id="ork"><IconStyle><color>ff3a92fb</color><scale>1.0</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon></IconStyle></Style>
<Style id="sub"><IconStyle><color>ff34d399</color><scale>0.6</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
${Object.entries(CABLE_STYLES).map(([type, s]) =>
  `<Style id="cable-${type}"><LineStyle><color>${s.color}</color><width>${s.width}</width></LineStyle></Style>`
).join('\n')}
`;

  // OLT folder
  kml += `<Folder><name>📡 OLT — Узлы связи</name>\n`;
  for (const d of districts) {
    kml += placemark(d.olt.id, `Модель: ${d.olt.model}<br/>Район: ${d.name}<br/>Ёмкость: ${d.olt.capacity} або.`, d.olt.lat, d.olt.lon, 'olt');
  }
  kml += `</Folder>\n`;

  // Transit Boxes folder
  kml += `<Folder><name>🔷 Транзитные муфты МТОК-96А</name>\n`;
  for (const d of districts) {
    kml += `<Folder><name>${d.name}</name>\n`;
    for (const tb of d.olt.transitBoxes) {
      kml += placemark(tb.id, `Район: ${d.name}<br/>OLT: ${d.olt.id}<br/>ОРК: ${tb.orks.length}`, tb.lat, tb.lon, 'tb');
    }
    kml += `</Folder>\n`;
  }
  kml += `</Folder>\n`;

  // ORK folder
  kml += `<Folder><name>📦 ОРК шкафы</name>\n`;
  for (const d of districts) {
    kml += `<Folder><name>${d.name}</name>\n`;
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        kml += placemark(ork.id, `PLC ${ork.splitter}, ${ork.subscribers.length} або.<br/>Муфта: ${tb.id}`, ork.lat, ork.lon, 'ork');
      }
    }
    kml += `</Folder>\n`;
  }
  kml += `</Folder>\n`;

  // Subscribers folder
  kml += `<Folder><name>🏠 Абоненты</name>\n`;
  for (const d of districts) {
    kml += `<Folder><name>${d.name} (${d.subscribers.length} або.)</name>\n`;
    for (const sub of d.subscribers) {
      kml += placemark(`#${sub.id} — ${sub.desc}`, `Район: ${d.name}<br/>ОРК: ${sub.orkId || '—'}<br/>Волокна: ${sub.fibers.working} раб. + ${sub.fibers.spare} зап.`, sub.lat, sub.lon, 'sub');
    }
    kml += `</Folder>\n`;
  }
  kml += `</Folder>\n`;

  // Cable folders by type
  const cableTypes: Cable['type'][] = ['ОКБ-10', 'ОКСНН-8', 'ОКСНН-4', 'ОКА-2'];
  const cableNames: Record<string, string> = {
    'ОКБ-10': '🟡 Кабель ОКБ-10 (магистраль, 8 вол.)',
    'ОКСНН-8': '🔵 Кабель ОКСНН-8 (распределительный, 8 вол.)',
    'ОКСНН-4': '🟠 Кабель ОКСНН-4 (питающий, 4 вол.)',
    'ОКА-2': '🟢 Кабель ОКА-2 дроп (абонентский, 2 вол.)',
  };

  for (const type of cableTypes) {
    const typeCables = cables.filter((c) => c.type === type);
    if (typeCables.length === 0) continue;
    kml += `<Folder><name>${cableNames[type]}</name>\n`;
    for (const cable of typeCables) {
      const desc = `Длина: ${Math.round(cable.lengthM)} м<br/>От: ${cable.fromId}<br/>До: ${cable.toId}<br/>Маршрут: ${cable.routedByOSRM ? 'по дорогам' : 'прямая'}`;
      kml += linePlacemark(`${cable.fromId}→${cable.toId}`, cable.coords, `cable-${type}`, desc);
    }
    kml += `</Folder>\n`;
  }

  kml += `</Document></kml>`;

  const zip = new JSZip();
  zip.file('doc.kml', kml);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return blob;
}
