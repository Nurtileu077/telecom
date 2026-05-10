import { District, Cable, Materials } from '@/types/network';
import { CostBreakdown, formatMoney } from '@/components/Network/CostCalc';

export async function exportPDF(
  projectName: string,
  districts: District[],
  cables: Cable[],
  materials: Materials,
  cost: CostBreakdown | null,
  mapElement: HTMLElement | null,
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const html2canvas = (await import('html2canvas')).default;

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 12;
  let y = margin;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('GPON Network Design Report', margin, y);
  y += 6;
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Project: ${projectName}`, margin, y);
  y += 5;
  pdf.text(`Generated: ${new Date().toLocaleString('ru')}`, margin, y);
  y += 8;

  // Summary
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Summary', margin, y); y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  const totalSubs = districts.reduce((s, d) => s + d.subscribers.length, 0);
  const totalOrks = districts.reduce((s, d) => s + d.olt.transitBoxes.reduce((ts, tb) => ts + tb.orks.length, 0), 0);
  const totalTBs = districts.reduce((s, d) => s + d.olt.transitBoxes.length, 0);
  const totalCableKm = (cables.reduce((s, c) => s + c.lengthM, 0) / 1000).toFixed(2);

  const summary = [
    ['Districts', districts.length.toString()],
    ['Subscribers', totalSubs.toString()],
    ['OLT units', districts.length.toString()],
    ['Transit Boxes', totalTBs.toString()],
    ['ORK cabinets', totalOrks.toString()],
    ['Total cable', `${totalCableKm} km`],
  ];
  for (const [k, v] of summary) {
    pdf.text(`${k}:`, margin, y);
    pdf.text(v, margin + 50, y);
    y += 4.5;
  }
  y += 4;

  // Map snapshot
  if (mapElement) {
    try {
      const canvas = await html2canvas(mapElement, { useCORS: true, allowTaint: true, scale: 1, logging: false });
      const imgData = canvas.toDataURL('image/jpeg', 0.85);
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height / canvas.width) * imgW;
      if (y + imgH > 270) { pdf.addPage(); y = margin; }
      pdf.addImage(imgData, 'JPEG', margin, y, imgW, Math.min(imgH, 120));
      y += Math.min(imgH, 120) + 6;
    } catch (e) {
      console.warn('Map snapshot failed', e);
    }
  }

  // Materials
  if (y > 240) { pdf.addPage(); y = margin; }
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Materials (Bill of Materials)', margin, y); y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);

  const matRows: [string, string, string][] = [
    ['OKB-10 (trunk, 8 fibers)', `${materials.cables['ОКБ-10']}`, 'm'],
    ['OKSNN-8 (distribution)', `${materials.cables['ОКСНН-8']}`, 'm'],
    ['OKSNN-4 (feeder)', `${materials.cables['ОКСНН-4']}`, 'm'],
    ['OKA-2 (drop)', `${materials.cables['ОКА-2']}`, 'm'],
    ['OLT Huawei MA5800-X7', `${materials.equipment.oltUnits}`, 'pcs'],
    ['Splitter 1:4 PLC', `${materials.equipment.splitter_1x4_L1 + materials.equipment.splitter_1x4_L2}`, 'pcs'],
    ['Splitter 1:8 PLC', `${materials.equipment.splitter_1x8_L2}`, 'pcs'],
    ['Splitter 1:16 PLC', `${materials.equipment.splitter_1x16_L2}`, 'pcs'],
    ['Mufta MTOK-96A IP68', `${materials.equipment.muftaMTOK96A}`, 'pcs'],
    ['ORK cabinet IP55', `${materials.equipment.orkBox}`, 'pcs'],
    ['Subscriber box ORB-32', `${materials.equipment.boxORB32}`, 'pcs'],
    ['ONT ZTE F601', `${materials.equipment.ontZTE_F601}`, 'pcs'],
    ['Pigtail SC/APC', `${materials.equipment.pigtailSCAPC}`, 'pcs'],
    ['Patchcord', `${materials.equipment.patchcord}`, 'pcs'],
    ['KDZS sleeve 40mm', `${materials.equipment.kdzsGilzy}`, 'pcs'],
    ['Anchor clamp', `${materials.equipment.clamps}`, 'pcs'],
  ];

  // table header
  pdf.setFont('helvetica', 'bold');
  pdf.text('Item', margin, y);
  pdf.text('Qty', margin + 110, y);
  pdf.text('Unit', margin + 135, y);
  y += 4;
  pdf.setLineWidth(0.2); pdf.line(margin, y - 2, pageW - margin, y - 2);
  pdf.setFont('helvetica', 'normal');

  for (const [name, qty, unit] of matRows) {
    if (y > 280) { pdf.addPage(); y = margin; }
    pdf.text(name, margin, y);
    pdf.text(qty, margin + 110, y);
    pdf.text(unit, margin + 135, y);
    y += 4.5;
  }
  y += 4;

  // Cost
  if (cost) {
    if (y > 260) { pdf.addPage(); y = margin; }
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Cost Estimation', margin, y); y += 6;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Cables subtotal: ${formatMoney(cost.subtotalCables, cost.currency)}`, margin, y); y += 5;
    pdf.text(`Equipment subtotal: ${formatMoney(cost.subtotalEquipment, cost.currency)}`, margin, y); y += 5;
    if (cost.subtotalLabor > 0) {
      pdf.text(`Labor subtotal: ${formatMoney(cost.subtotalLabor, cost.currency)}`, margin, y); y += 5;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.text(`GRAND TOTAL: ${formatMoney(cost.grandTotal, cost.currency)}`, margin, y);
  }

  pdf.save(`${projectName.replace(/[^\w\s-]/g, '_')}-report.pdf`);
}
