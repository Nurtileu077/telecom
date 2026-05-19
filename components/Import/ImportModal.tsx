'use client';
import { useState, useRef, useCallback, useMemo } from 'react';
import { Subscriber, ProjectSettings, Project } from '@/types/network';
import { importExcel } from './ExcelImporter';
import { importKmz, importKmzBatch, importKmzRaw, importKmzBatchRaw, type KmlRawLine } from './KmzImporter';
import { buildStructured, type KmlPoint, type KmlLine } from './KmlStructured';
import type { District, Cable } from '@/types/network';
import { importCsv, parseTabular } from './CsvImporter';

export type ImportMode = 'replace' | 'append';
export type NetworkImportMode = 'replace' | 'merge';
// One district may have multiple OLTs.  Subscribers will be split by nearest.
export type OltLocations = Record<string, Array<{ lat: number; lon: number }>>;

interface Props {
  onClose: () => void;
  onBuild: (subscribers: Subscriber[], settings: ProjectSettings, source: string, mode: ImportMode, oltLocations?: OltLocations) => void;
  onLoadRaw: (subs: Subscriber[], lines: KmlRawLine[], source: string) => void;
  onLoadStructured: (districts: District[], cables: Cable[], joints: import('@/types/network').InlineJoint[], source: string) => void;
  onImportNetwork: (project: Project, mode: NetworkImportMode) => void;
  currentSettings: ProjectSettings;
  hasExistingData: boolean;
}

// Parse "lat, lng" / "lat lng" / "lat; lng" — returns null if invalid.
function parseLatLngInput(s: string): { lat: number; lon: number } | null {
  if (!s) return null;
  const m = s.trim().match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lon = parseFloat(m[2].replace(',', '.'));
  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < 35 || lat > 60 || lon < 45 || lon > 90) return null;
  return { lat, lon };
}

const TEST_SUBSCRIBERS: Subscriber[] = [
  { id: 't1', lat: 40.777053, lon: 68.320873, desc: 'Жетісай қ., С.Қожанов/Әл-Фараби қиылысы', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't2', lat: 40.768823, lon: 68.318157, desc: 'Жетісай қ., М.Әуезов/С.Ерубаев қиылысы', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't3', lat: 40.771081, lon: 68.315041, desc: 'Жетісай қ., Т.Дайрашев/№48 мектеп алды', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't4', lat: 40.765288, lon: 68.314124, desc: 'Жетісай қ., Жетісай Грант парк жанына', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't5', lat: 40.784949, lon: 68.327514, desc: 'Жетісай қ., Нұрай қонақүй алды', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't6', lat: 40.785821, lon: 68.326146, desc: 'Жетісай қ., Т.Дайрашев/А.Қалыбеков қиылысы', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't7', lat: 40.778944, lon: 68.315722, desc: 'Жетісай қ., Грант Холл тойхана алды', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't8', lat: 40.773006, lon: 68.316824, desc: 'Жетісай қ., Махамбет/Оспанов қиылысы', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't9', lat: 40.785248, lon: 68.298229, desc: 'Жетісай қ., Табиғат тойхана артына', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
  { id: 't10', lat: 40.790642, lon: 68.317131, desc: 'Жетісай қ., Ескендиров/Мұсабаев қиылысы', district: 'Жетысай', fibers: { working: 2, spare: 1 } },
];

export default function ImportModal({ onClose, onBuild, onLoadRaw, onLoadStructured, onImportNetwork, currentSettings, hasExistingData }: Props) {
  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [settings, setSettings] = useState<ProjectSettings>(currentSettings);
  const [mode, setMode] = useState<ImportMode>(hasExistingData ? 'append' : 'replace');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'file' | 'paste' | 'network'>('file');
  const [pasteText, setPasteText] = useState('');
  const [pasteDistrict, setPasteDistrict] = useState('Импорт');
  const fileRef = useRef<HTMLInputElement>(null);
  const netFileRef = useRef<HTMLInputElement>(null);

  // Network JSON import state
  const [netProject, setNetProject] = useState<Project | null>(null);
  const [netFileName, setNetFileName] = useState('');
  const [netError, setNetError] = useState('');
  const [netMode, setNetMode] = useState<NetworkImportMode>(hasExistingData ? 'merge' : 'replace');
  const [netDragging, setNetDragging] = useState(false);

  // OLT (узел связи) coordinates per district — user-supplied. Keeps the raw
  // text so the user can paste freely; we only parse on submit.
  const [oltInputs, setOltInputs] = useState<Record<string, string>>({});
  const [oltBulkText, setOltBulkText] = useState('');
  const [oltError, setOltError] = useState('');

  const parsePaste = useCallback(() => {
    setError('');
    try {
      const subs = parseTabular(pasteText, pasteDistrict);
      if (subs.length === 0) throw new Error('Не нашёл корректных координат. Формат: lat<tab>lon<tab>desc');
      setSubscribers(subs);
      setFileName(`Вставка (${pasteDistrict})`);
    } catch (e: any) {
      setError(e.message);
    }
  }, [pasteText, pasteDistrict]);

  // Per-file breakdown for multi-KML imports — kept for the summary panel.
  const [batchReport, setBatchReport] = useState<Array<{ name: string; count: number; error?: string }> | null>(null);
  // Raw mode: load KML 1:1 (points + LineStrings) without running the build.
  const [rawMode, setRawMode] = useState(true);
  const [rawLines, setRawLines] = useState<KmlRawLine[]>([]);
  // Structured KML data — populated when the file has classifiable
  // folder structure (OLT/Муфта/ОРК/Кабель…).  When non-null and rawMode
  // is on, submitting builds a real District tree instead of dumping flat.
  const [structuredPoints, setStructuredPoints] = useState<KmlPoint[]>([]);
  const [structuredLines, setStructuredLines] = useState<KmlLine[]>([]);
  const [structuredPreview, setStructuredPreview] = useState<ReturnType<typeof buildStructured> | null>(null);

  const handleFiles = useCallback(async (rawFiles: FileList | File[]) => {
    const files = Array.from(rawFiles);
    if (files.length === 0) return;
    setLoading(true); setError(''); setBatchReport(null); setRawLines([]);
    setStructuredPoints([]); setStructuredLines([]); setStructuredPreview(null);
    try {
      const allKml = files.every((f) => /\.(kml|kmz)$/i.test(f.name));

      // Multi-file path: batch of KML/KMZ — each file becomes a district / layer.
      if (files.length > 1 && allKml) {
        const { subscribers: subs, lines, structuredPoints: sp, structuredLines: sl, perFile } = await importKmzBatchRaw(files);
        setBatchReport(perFile.map((p) => ({ name: p.name, count: p.subs + p.lines, error: p.error })));
        setFileName(`${files.length} KML/KMZ файлов`);
        if (subs.length === 0 && lines.length === 0) {
          throw new Error('Ни точек, ни линий не нашлось');
        }
        setSubscribers(subs);
        setRawLines(lines);
        setStructuredPoints(sp);
        setStructuredLines(sl);
        // Build a preview right away so the user sees the classification result
        // Multi-file batch: merge everything into one combined district.
        // Vendors split a project across files by LAYER (Боксы.kml /
        // Кабели-ОК-48.kml / Абоненты.kml) — without merging, cables from
        // one file can't snap to entities in another.
        const mergedName = files.length === 1 ? undefined : 'Сеть';
        const preview = buildStructured(sp, sl, { mergeAll: true, mergedName });
        if (preview.stats.olt + preview.stats.tb + preview.stats.ork > 0 || preview.stats.cablesMatched > 0) {
          setStructuredPreview(preview);
        }
        return;
      }

      const file = files[0];
      setFileName(file.name);
      const ext = file.name.toLowerCase();
      if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        const subs = await importExcel(file);
        if (subs.length === 0) throw new Error('Файл не содержит данных абонентов');
        setSubscribers(subs);
      } else if (ext.endsWith('.kml') || ext.endsWith('.kmz')) {
        const { subscribers: subs, lines, structuredPoints: sp, structuredLines: sl } = await importKmzRaw(file);
        if (subs.length === 0 && lines.length === 0) {
          throw new Error('Ни точек, ни линий не нашлось');
        }
        setSubscribers(subs);
        setRawLines(lines);
        setStructuredPoints(sp);
        setStructuredLines(sl);
        const preview = buildStructured(sp, sl);
        if (preview.stats.olt + preview.stats.tb + preview.stats.ork > 0 || preview.stats.cablesMatched > 0) {
          setStructuredPreview(preview);
        }
      } else if (ext.endsWith('.csv') || ext.endsWith('.tsv') || ext.endsWith('.txt')) {
        const subs = await importCsv(file);
        if (subs.length === 0) throw new Error('Файл не содержит данных абонентов');
        setSubscribers(subs);
      } else {
        throw new Error('Используйте .xlsx, .kml, .kmz или .csv');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFile = useCallback((file: File) => handleFiles([file]), [handleFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleNetFile = useCallback(async (file: File) => {
    setNetError('');
    if (!file.name.endsWith('.json')) { setNetError('Нужен файл .json (экспорт проекта)'); return; }
    try {
      const text = await file.text();
      const p = JSON.parse(text) as Project;
      if (!p.districts || !Array.isArray(p.districts)) throw new Error('Не похоже на экспорт проекта GPON');
      setNetProject(p);
      setNetFileName(file.name);
    } catch (e: any) {
      setNetError(e.message ?? 'Ошибка разбора JSON');
    }
  }, []);

  const byDistrict = subscribers
    ? subscribers.reduce((m, s) => {
        m[s.district] = (m[s.district] || 0) + 1;
        return m;
      }, {} as Record<string, number>)
    : {};

  // Apply a single bulk-paste textarea → per-district inputs.
  // Format per line:
  //   "District: lat, lng"   — append to that district
  //   "lat, lng"             — append to the only district (if exactly one)
  // Multiple lines for the same district build up an N-OLT list.
  const applyBulkOlts = useCallback(() => {
    setOltError('');
    const additions: Record<string, string[]> = {};
    const lines = oltBulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let bad = 0;
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const district = line.slice(0, idx).trim();
        const coords = line.slice(idx + 1).trim();
        if (parseLatLngInput(coords)) {
          (additions[district] ||= []).push(coords);
        } else bad++;
      } else if (parseLatLngInput(line) && Object.keys(byDistrict).length === 1) {
        (additions[Object.keys(byDistrict)[0]] ||= []).push(line);
      } else {
        bad++;
      }
    }
    setOltInputs((prev) => {
      const next = { ...prev };
      for (const [d, lines] of Object.entries(additions)) {
        const existing = next[d]?.trim();
        next[d] = existing ? `${existing}\n${lines.join('\n')}` : lines.join('\n');
      }
      return next;
    });
    if (bad > 0) setOltError(`${bad} строк не распознано. Формат: «Район: lat, lng»`);
  }, [oltBulkText, byDistrict]);

  // Each district's textarea may contain multiple lines = multiple OLTs.
  // Returns a map district → array of valid {lat, lon}, dropping invalid lines.
  const parsedOlts: OltLocations = useMemo(() => {
    const out: OltLocations = {};
    for (const [d, txt] of Object.entries(oltInputs)) {
      const list: { lat: number; lon: number }[] = [];
      for (const ln of txt.split(/\r?\n/)) {
        const p = parseLatLngInput(ln);
        if (p) list.push(p);
      }
      if (list.length > 0) out[d] = list;
    }
    return out;
  }, [oltInputs]);

  const oltOkCount = Object.values(parsedOlts).reduce((s, arr) => s + arr.length, 0);
  const districtCount = Object.keys(byDistrict).length;
  const districtsWithOlt = Object.keys(parsedOlts).length;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl w-[500px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-[#1e3a5f]">
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Импорт данных</h2>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0] transition-colors">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Mode selector */}
          {hasExistingData && (
            <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2">
              <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-2">Режим импорта</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode('append')}
                  className={`p-2 rounded-md text-xs transition-all ${mode === 'append' ? 'bg-[#34d399]/15 border border-[#34d399]/50 text-[#34d399]' : 'border border-[#1e3a5f] text-[#94a3b8] hover:border-[#1e3a5f]/80'}`}
                >
                  ➕ Добавить
                  <div className="text-[9px] text-[#64748b] mt-0.5">К текущей карте</div>
                </button>
                <button
                  onClick={() => setMode('replace')}
                  className={`p-2 rounded-md text-xs transition-all ${mode === 'replace' ? 'bg-[#f87171]/15 border border-[#f87171]/50 text-[#f87171]' : 'border border-[#1e3a5f] text-[#94a3b8] hover:border-[#1e3a5f]/80'}`}
                >
                  ♻️ Заменить
                  <div className="text-[9px] text-[#64748b] mt-0.5">Стереть и начать заново</div>
                </button>
              </div>
            </div>
          )}

          {/* File vs Paste vs Network tabs */}
          {!subscribers && !netProject && (
            <div className="flex gap-1 bg-[#0a0e1a] p-1 rounded-lg">
              <button onClick={() => setTab('file')} className={`flex-1 py-1.5 text-xs rounded ${tab === 'file' ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-[#64748b]'}`}>📂 Файл</button>
              <button onClick={() => setTab('paste')} className={`flex-1 py-1.5 text-xs rounded ${tab === 'paste' ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-[#64748b]'}`}>📋 Вставка</button>
              <button onClick={() => setTab('network')} className={`flex-1 py-1.5 text-xs rounded ${tab === 'network' ? 'bg-[#a78bfa]/15 text-[#a78bfa]' : 'text-[#64748b]'}`}>🗺 Сеть</button>
            </div>
          )}

          {!subscribers && tab === 'paste' && (
            <div className="space-y-2">
              <input
                value={pasteDistrict}
                onChange={(e) => setPasteDistrict(e.target.value)}
                placeholder="Название района"
                className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]"
              />
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={8}
                placeholder={`Вставьте координаты:\n40.777053\t68.320873\tАдрес\n40.768823\t68.318157\tАдрес 2`}
                className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-[10px] text-[#e2e8f0] font-mono focus:outline-none focus:border-[#38bdf8] resize-none"
              />
              <button onClick={parsePaste} disabled={!pasteText.trim()} className="w-full py-1.5 bg-[#34d399]/15 hover:bg-[#34d399]/25 disabled:opacity-30 text-[#34d399] text-xs rounded transition-colors">
                ✓ Распознать
              </button>
              {error && <p className="text-xs text-[#f87171]">⚠️ {error}</p>}
            </div>
          )}

          {/* Network JSON tab */}
          {!netProject && tab === 'network' && (
            <div className="space-y-3">
              <p className="text-[11px] text-[#94a3b8]">
                Загрузите <b className="text-[#e2e8f0]">экспорт проекта .json</b> — готовую схему OLT → Муфта → ОРК → абоненты.<br/>
                Кластеризация не происходит — сеть загружается как есть.
              </p>

              {/* Mode */}
              {hasExistingData && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setNetMode('merge')}
                    className={`p-2 rounded-md text-xs transition-all ${netMode === 'merge' ? 'bg-[#a78bfa]/15 border border-[#a78bfa]/50 text-[#a78bfa]' : 'border border-[#1e3a5f] text-[#94a3b8]'}`}
                  >
                    ➕ Добавить районы
                    <div className="text-[9px] text-[#64748b] mt-0.5">Новые добавятся, существующие — не тронуты</div>
                  </button>
                  <button
                    onClick={() => setNetMode('replace')}
                    className={`p-2 rounded-md text-xs transition-all ${netMode === 'replace' ? 'bg-[#f87171]/15 border border-[#f87171]/50 text-[#f87171]' : 'border border-[#1e3a5f] text-[#94a3b8]'}`}
                  >
                    ♻️ Заменить проект
                    <div className="text-[9px] text-[#64748b] mt-0.5">Текущий проект будет заменён</div>
                  </button>
                </div>
              )}

              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${netDragging ? 'border-[#a78bfa] bg-[#a78bfa]/5' : 'border-[#1e3a5f] hover:border-[#a78bfa]/50'}`}
                onDragOver={(e) => { e.preventDefault(); setNetDragging(true); }}
                onDragLeave={() => setNetDragging(false)}
                onDrop={(e) => { e.preventDefault(); setNetDragging(false); const f = e.dataTransfer.files[0]; if (f) handleNetFile(f); }}
                onClick={() => netFileRef.current?.click()}
              >
                <input ref={netFileRef} type="file" accept=".json" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) handleNetFile(f); }} />
                <div className="text-3xl mb-2">🗺</div>
                <p className="text-sm text-[#e2e8f0] mb-1">Перетащите или нажмите</p>
                <p className="text-xs text-[#64748b]">Файл .json (экспорт проекта)</p>
                {netError && <p className="mt-2 text-xs text-[#f87171]">⚠️ {netError}</p>}
              </div>
            </div>
          )}

          {/* Network project loaded summary */}
          {netProject && (
            <div className="space-y-3">
              <div className="bg-[#0a0e1a] border border-[#a78bfa]/30 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-[#e2e8f0] truncate">🗺 {netProject.name || netFileName}</h3>
                  <button onClick={() => { setNetProject(null); setNetFileName(''); setNetError(''); }} className="text-[10px] text-[#64748b] hover:text-[#38bdf8] ml-2">Сменить</button>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center">
                    <div className="text-lg font-mono font-bold text-[#a78bfa]">{netProject.districts.length}</div>
                    <div className="text-[10px] text-[#64748b]">районов</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-mono font-bold text-[#38bdf8]">{netProject.districts.reduce((s, d) => s + d.subscribers.length, 0)}</div>
                    <div className="text-[10px] text-[#64748b]">абонентов</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-mono font-bold text-[#34d399]">{(netProject.cables ?? []).length}</div>
                    <div className="text-[10px] text-[#64748b]">кабелей</div>
                  </div>
                </div>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {netProject.districts.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-[11px]">
                      <span className="text-[#94a3b8]">{d.name}</span>
                      <span className="text-[#64748b] font-mono">{d.subscribers.length} або. · {d.olt.transitBoxes.length} муфт</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mode selector (only when there is existing data) */}
              {hasExistingData && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setNetMode('merge')}
                    className={`p-2 rounded-md text-xs transition-all ${netMode === 'merge' ? 'bg-[#a78bfa]/15 border border-[#a78bfa]/50 text-[#a78bfa]' : 'border border-[#1e3a5f] text-[#94a3b8]'}`}
                  >
                    ➕ Добавить районы
                    <div className="text-[9px] text-[#64748b] mt-0.5">Новые добавятся, общие — пересобрать</div>
                  </button>
                  <button
                    onClick={() => setNetMode('replace')}
                    className={`p-2 rounded-md text-xs transition-all ${netMode === 'replace' ? 'bg-[#f87171]/15 border border-[#f87171]/50 text-[#f87171]' : 'border border-[#1e3a5f] text-[#94a3b8]'}`}
                  >
                    ♻️ Заменить проект
                    <div className="text-[9px] text-[#64748b] mt-0.5">Текущий проект будет заменён</div>
                  </button>
                </div>
              )}
            </div>
          )}

          {!subscribers && !netProject && tab === 'file' && (
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${dragging ? 'border-[#38bdf8] bg-[#38bdf8]/5' : 'border-[#1e3a5f] hover:border-[#38bdf8]/50'}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.kml,.kmz,.csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => { const fs = e.target.files; if (fs && fs.length > 0) handleFiles(fs); }}
              />
              {loading ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-[#94a3b8]">Обработка файла...</p>
                </div>
              ) : (
                <>
                  <div className="text-3xl mb-2">📂</div>
                  <p className="text-sm text-[#e2e8f0] mb-1">Перетащите файл/папку или нажмите</p>
                  <p className="text-xs text-[#64748b]">.xlsx, .xls, .kml, .kmz, .csv, .tsv</p>
                  <p className="text-[10px] text-[#475569] mt-1">Можно сразу несколько KML — каждый станет своим слоем-районом</p>
                </>
              )}
              {error && <p className="mt-2 text-xs text-[#f87171]">⚠️ {error}</p>}
            </div>
          )}

          {/* Per-file batch report after a multi-KML import */}
          {batchReport && batchReport.length > 0 && (
            <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 max-h-32 overflow-y-auto">
              <div className="text-[10px] text-[#64748b] mb-1">Файлы в импорте:</div>
              {batchReport.map((r) => (
                <div key={r.name} className="flex items-center justify-between text-[10px]">
                  <span className="text-[#94a3b8] truncate" title={r.name}>{r.name}</span>
                  <span className={`font-mono ${r.error ? 'text-[#f87171]' : 'text-[#34d399]'}`}>
                    {r.error ? `⚠ ${r.error}` : `${r.count} точек`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!subscribers && (
            <button
              onClick={() => { setSubscribers(TEST_SUBSCRIBERS); setFileName('Демо: Жетысай'); }}
              className="w-full py-2 px-3 border border-[#1e3a5f] rounded-lg text-xs text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#38bdf8]/40 transition-colors"
            >
              🧪 Загрузить тестовые данные (Жетысай, 10 або.)
            </button>
          )}

          {subscribers && (
            <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[#e2e8f0] truncate">📄 {fileName}</h3>
                <button onClick={() => { setSubscribers(null); setBatchReport(null); }} className="text-[10px] text-[#64748b] hover:text-[#38bdf8] transition-colors flex-shrink-0 ml-2">
                  Сменить
                </button>
              </div>
              <div className="flex items-center gap-4 mb-2">
                <div>
                  <div className="text-xl font-mono font-bold text-[#38bdf8]">{subscribers.length}</div>
                  <div className="text-[10px] text-[#64748b]">абонентов</div>
                </div>
                <div>
                  <div className="text-xl font-mono font-bold text-[#34d399]">{Object.keys(byDistrict).length}</div>
                  <div className="text-[10px] text-[#64748b]">районов</div>
                </div>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {Object.entries(byDistrict).map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between text-xs">
                    <span className="text-[#94a3b8]">{name}</span>
                    <span className="font-mono text-[#64748b]">{count} або.</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {subscribers && !rawMode && (
            <div className="space-y-2 bg-[#0a0e1a] border border-[#38bdf8]/30 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[#38bdf8]">📡 OLT (узлы связи)</h3>
                <span className="text-[10px] text-[#64748b]">{oltOkCount} OLT в {districtsWithOlt}/{districtCount} р-нах</span>
              </div>
              <p className="text-[10px] text-[#64748b]">
                Один район = <b>сколько угодно OLT</b>. Каждая строка — отдельный OLT.<br/>
                Абоненты автоматически разойдутся по ближайшему OLT (Voronoi).<br/>
                Пусто → один OLT в центре района (как раньше).
              </p>

              <details className="bg-[#0d1b2a] rounded border border-[#1e3a5f]/50">
                <summary className="text-[10px] text-[#94a3b8] px-2 py-1.5 cursor-pointer hover:text-[#e2e8f0]">
                  📋 Вставить блоком (добавится к полям)
                </summary>
                <div className="p-2 space-y-1.5">
                  <textarea
                    value={oltBulkText}
                    onChange={(e) => setOltBulkText(e.target.value)}
                    rows={6}
                    placeholder={districtCount === 1
                      ? `Каждая строка — один OLT:\n43.32, 68.31\n43.31, 68.30\n43.29, 68.31\n…`
                      : `Район: lat, lng (повторить для нескольких OLT в одном районе)\n${Object.keys(byDistrict)[0]}: 40.78, 68.32\n${Object.keys(byDistrict)[0]}: 40.79, 68.33`}
                    className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-[10px] text-[#e2e8f0] font-mono focus:outline-none focus:border-[#38bdf8] resize-none"
                  />
                  <button onClick={applyBulkOlts} disabled={!oltBulkText.trim()} className="w-full py-1 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 disabled:opacity-30 text-[#38bdf8] text-[10px] rounded transition-colors">
                    ↧ Добавить к полям
                  </button>
                  {oltError && <p className="text-[10px] text-[#fbbf24]">⚠️ {oltError}</p>}
                </div>
              </details>

              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {Object.keys(byDistrict).map((d) => {
                  const txt = oltInputs[d] || '';
                  const lines = txt.split(/\r?\n/);
                  const validCount = lines.filter((l) => parseLatLngInput(l)).length;
                  const nonEmptyCount = lines.filter((l) => l.trim().length > 0).length;
                  const ok = nonEmptyCount > 0 ? (validCount === nonEmptyCount) : null;
                  return (
                    <div key={d} className="flex items-start gap-2">
                      <span className="text-[10px] text-[#94a3b8] w-20 truncate pt-1" title={d}>{d}</span>
                      <textarea
                        value={txt}
                        onChange={(e) => setOltInputs((p) => ({ ...p, [d]: e.target.value }))}
                        placeholder={'lat, lng (по строке на OLT)\nнеобяз.'}
                        rows={Math.max(2, Math.min(6, nonEmptyCount + 1))}
                        className={`flex-1 bg-[#0a0e1a] border rounded px-1.5 py-1 text-[10px] text-[#e2e8f0] font-mono leading-snug resize-none focus:outline-none ${ok === false ? 'border-[#f87171] focus:border-[#f87171]' : ok ? 'border-[#34d399]/60 focus:border-[#34d399]' : 'border-[#1e3a5f] focus:border-[#38bdf8]'}`}
                      />
                      <span className={`text-[10px] w-12 pt-1 font-mono ${ok === false ? 'text-[#f87171]' : ok ? 'text-[#34d399]' : 'text-[#475569]'}`} title="Распознанных OLT / введённых строк">
                        {nonEmptyCount > 0 ? `${validCount}/${nonEmptyCount}` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {subscribers && (
            <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2">
              <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-2">Режим импорта</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setRawMode(true)}
                  className={`p-2 rounded-md text-xs transition-all text-left ${rawMode ? 'bg-[#94a3b8]/20 border border-[#94a3b8] text-[#e2e8f0]' : 'border border-[#1e3a5f] text-[#94a3b8]'}`}
                >
                  📥 Как есть
                  <div className="text-[9px] text-[#64748b] mt-0.5">Просто показать точки и линии</div>
                </button>
                <button
                  onClick={() => setRawMode(false)}
                  className={`p-2 rounded-md text-xs transition-all text-left ${!rawMode ? 'bg-[#38bdf8]/15 border border-[#38bdf8] text-[#38bdf8]' : 'border border-[#1e3a5f] text-[#94a3b8]'}`}
                >
                  🚀 Построить
                  <div className="text-[9px] text-[#64748b] mt-0.5">Кластеризация + кабели</div>
                </button>
              </div>
              {rawLines.length > 0 && rawMode && !structuredPreview && (
                <p className="mt-2 text-[10px] text-[#fbbf24]">
                  📐 В файле найдено {rawLines.length} линий — покажу как нарисовано.
                </p>
              )}
              {structuredPreview && rawMode && (
                <div className="mt-2 p-2 bg-[#34d399]/10 border border-[#34d399]/40 rounded text-[10px] text-[#34d399] space-y-0.5">
                  <div>✓ Распознана структура сети:</div>
                  <div className="grid grid-cols-5 gap-1 font-mono text-center mt-1">
                    <div><b>{structuredPreview.stats.olt}</b> OLT</div>
                    <div><b>{structuredPreview.stats.tb}</b> Муфт</div>
                    <div><b>{structuredPreview.stats.ork}</b> ОРК</div>
                    <div><b>{structuredPreview.stats.sub}</b> Аб.</div>
                    <div><b>{structuredPreview.stats.cablesMatched}</b> кабелей</div>
                  </div>
                  {(structuredPreview.stats.supports > 0 || structuredPreview.stats.joints > 0 || structuredPreview.stats.radio > 0) && (
                    <div className="mt-1 text-[#94a3b8]">
                      Доп.: {structuredPreview.stats.supports} опор, {structuredPreview.stats.joints} узлов
                      {structuredPreview.stats.radio > 0 ? `, ${structuredPreview.stats.radio} РРЛ` : ''} (точки крепления для кабелей)
                    </div>
                  )}
                  {structuredPreview.stats.cablesOrphan > 0 && (
                    <div className="text-[#fbbf24] mt-1">
                      ⚠️ {structuredPreview.stats.cablesOrphan} линий не привязалось к сущностям (расстояние &gt;75м)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {subscribers && !rawMode && (
            <div className="space-y-2">
              <h3 className="text-[10px] text-[#64748b] uppercase tracking-wider">Параметры построения</h3>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-[#64748b] block mb-1">Запас кабеля</span>
                  <select value={settings.cableReserve}
                          onChange={(e) => setSettings((s) => ({ ...s, cableReserve: +e.target.value }))}
                          className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]">
                    <option value={1.05}>+5%</option>
                    <option value={1.10}>+10%</option>
                    <option value={1.15}>+15%</option>
                    <option value={1.20}>+20%</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] text-[#64748b] block mb-1">OSRM маршруты</span>
                  <div className="flex items-center gap-2 mt-1">
                    <button onClick={() => setSettings((s) => ({ ...s, useOSRM: !s.useOSRM }))}
                            className={`w-8 h-4 rounded-full transition-colors duration-200 relative ${settings.useOSRM ? 'bg-[#38bdf8]' : 'bg-[#1e3a5f]'}`}>
                      <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform duration-200 ${settings.useOSRM ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-xs text-[#94a3b8]">{settings.useOSRM ? 'по дорогам' : 'прямые'}</span>
                  </div>
                </label>
                <label className="block">
                  <span className="text-[10px] text-[#64748b] block mb-1">Сторона дороги</span>
                  <select
                    value={settings.roadSide ?? 'left'}
                    onChange={(e) => setSettings((s) => ({
                      ...s,
                      roadSide: e.target.value as 'center' | 'left' | 'right',
                    }))}
                    className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]"
                  >
                    <option value="left">Только левая</option>
                    <option value="right">Только правая</option>
                    <option value="center">По оси дороги</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] text-[#64748b] block mb-1">Отступ от оси, м</span>
                  <input
                    type="number"
                    min={2}
                    max={12}
                    step={0.5}
                    value={settings.roadSideOffsetM ?? 4}
                    onChange={(e) => setSettings((s) => ({
                      ...s,
                      roadSideOffsetM: Math.max(2, Math.min(12, parseFloat(e.target.value) || 4)),
                    }))}
                    className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] font-mono"
                  />
                </label>
              </div>
              {/* Sergek-cascade: L1-сплиттер на муфте, L2 однозначно следует из L1
                  для L1×L2 = 64 (макс. абонентов на порт OLT). */}
              <label className="block">
                <span className="text-[10px] text-[#64748b] block mb-1">L1-сплиттер (на муфте)</span>
                <select
                  value={settings.l1SplitterDefault ?? '1:8'}
                  onChange={(e) => setSettings((s) => ({ ...s, l1SplitterDefault: e.target.value as '1:4' | '1:8' }))}
                  className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]"
                >
                  <option value="1:4">1:4 → 4 ОРКСП × L2 1:16 = 64 камеры/порт</option>
                  <option value="1:8">1:8 → 8 ОРКСП × L2 1:8 = 64 камеры/порт</option>
                </select>
              </label>
              <div className="text-[10px] text-[#475569] bg-[#0a0e1a] border border-[#1e3a5f]/40 rounded px-2 py-1.5">
                ⚙ Схема Sergek: OLT—ОК-16—1:8—ОК-4—ОРКСП—ОК-16—8 камер. ≤64/порт.
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#1e3a5f] flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 px-4 border border-[#1e3a5f] rounded-lg text-xs text-[#94a3b8] hover:text-[#e2e8f0] transition-colors">
            Отмена
          </button>
          {netProject ? (
            <button
              onClick={() => { onImportNetwork(netProject, netMode); onClose(); }}
              className="flex-1 py-2 px-4 bg-[#a78bfa] hover:bg-[#c4b5fd] rounded-lg text-xs font-semibold text-[#0a0e1a] transition-colors"
            >
              {netMode === 'merge' ? '➕ Добавить районы' : '♻️ Заменить проект'}
            </button>
          ) : (
            <button
              onClick={() => {
                if (!subscribers) return;
                if (rawMode) {
                  // If we recognised proper folder structure, load the typed
                  // tree so the AI / consolidation / export systems see real
                  // OLT/TB/ORK/cables instead of a flat dump of gray dots.
                  if (structuredPreview) {
                    onLoadStructured(structuredPreview.districts, structuredPreview.cables, structuredPreview.inlineJoints, fileName);
                  } else {
                    onLoadRaw(subscribers, rawLines, fileName);
                  }
                } else {
                  onBuild(subscribers, settings, fileName, mode, parsedOlts);
                }
              }}
              disabled={!subscribers}
              className={`flex-1 py-2 px-4 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold transition-colors ${
                rawMode
                  ? (structuredPreview ? 'bg-[#34d399] hover:bg-[#6ee7b7] text-[#0a0e1a]' : 'bg-[#94a3b8] hover:bg-[#cbd5e1] text-[#0a0e1a]')
                  : 'bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#0a0e1a]'
              }`}
            >
              {rawMode
                ? (structuredPreview
                    ? `✓ Загрузить сеть (${structuredPreview.stats.olt}+${structuredPreview.stats.tb}+${structuredPreview.stats.ork}+${structuredPreview.stats.cablesMatched})`
                    : `📥 Загрузить как есть${rawLines.length > 0 ? ` (+${rawLines.length} линий)` : ''}`)
                : mode === 'append' ? '➕ Добавить и построить' : '🚀 Построить сеть'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
