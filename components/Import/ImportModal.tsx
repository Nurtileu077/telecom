'use client';
import { useState, useRef, useCallback } from 'react';
import { Subscriber, ProjectSettings } from '@/types/network';
import { importExcel } from './ExcelImporter';
import { importKmz } from './KmzImporter';
import { importCsv, parseTabular } from './CsvImporter';

export type ImportMode = 'replace' | 'append';

interface Props {
  onClose: () => void;
  onBuild: (subscribers: Subscriber[], settings: ProjectSettings, source: string, mode: ImportMode) => void;
  currentSettings: ProjectSettings;
  hasExistingData: boolean;
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

export default function ImportModal({ onClose, onBuild, currentSettings, hasExistingData }: Props) {
  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [settings, setSettings] = useState<ProjectSettings>(currentSettings);
  const [mode, setMode] = useState<ImportMode>(hasExistingData ? 'append' : 'replace');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');
  const [pasteDistrict, setPasteDistrict] = useState('Импорт');
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(''); setFileName(file.name);
    try {
      let subs: Subscriber[];
      const ext = file.name.toLowerCase();
      if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        subs = await importExcel(file);
      } else if (ext.endsWith('.kml') || ext.endsWith('.kmz')) {
        subs = await importKmz(file);
      } else if (ext.endsWith('.csv') || ext.endsWith('.tsv') || ext.endsWith('.txt')) {
        subs = await importCsv(file);
      } else {
        throw new Error('Используйте .xlsx, .kml, .kmz или .csv');
      }
      if (subs.length === 0) throw new Error('Файл не содержит данных абонентов');
      setSubscribers(subs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const byDistrict = subscribers
    ? subscribers.reduce((m, s) => {
        m[s.district] = (m[s.district] || 0) + 1;
        return m;
      }, {} as Record<string, number>)
    : {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
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

          {/* File vs Paste tabs */}
          {!subscribers && (
            <div className="flex gap-1 bg-[#0a0e1a] p-1 rounded-lg">
              <button onClick={() => setTab('file')} className={`flex-1 py-1.5 text-xs rounded ${tab === 'file' ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-[#64748b]'}`}>📂 Файл</button>
              <button onClick={() => setTab('paste')} className={`flex-1 py-1.5 text-xs rounded ${tab === 'paste' ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-[#64748b]'}`}>📋 Вставка</button>
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

          {!subscribers && tab === 'file' && (
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${dragging ? 'border-[#38bdf8] bg-[#38bdf8]/5' : 'border-[#1e3a5f] hover:border-[#38bdf8]/50'}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.kml,.kmz,.csv,.tsv,.txt" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {loading ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-[#94a3b8]">Обработка файла...</p>
                </div>
              ) : (
                <>
                  <div className="text-3xl mb-2">📂</div>
                  <p className="text-sm text-[#e2e8f0] mb-1">Перетащите файл или нажмите</p>
                  <p className="text-xs text-[#64748b]">.xlsx, .xls, .kml, .kmz, .csv, .tsv</p>
                </>
              )}
              {error && <p className="mt-2 text-xs text-[#f87171]">⚠️ {error}</p>}
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
                <button onClick={() => setSubscribers(null)} className="text-[10px] text-[#64748b] hover:text-[#38bdf8] transition-colors flex-shrink-0 ml-2">
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

          {subscribers && (
            <div className="space-y-2">
              <h3 className="text-[10px] text-[#64748b] uppercase tracking-wider">Настройки построения</h3>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-[#64748b] block mb-1">Макс. або. на ОРК</span>
                  <select value={settings.maxPerORK}
                          onChange={(e) => setSettings((s) => ({ ...s, maxPerORK: +e.target.value }))}
                          className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]">
                    <option value={4}>4</option>
                    <option value={8}>8</option>
                    <option value={16}>16</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] text-[#64748b] block mb-1">Макс. ОРК на ТМ</span>
                  <select value={settings.maxORKperTB}
                          onChange={(e) => setSettings((s) => ({ ...s, maxORKperTB: +e.target.value }))}
                          className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]">
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                    <option value={8}>8</option>
                  </select>
                </label>
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
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#1e3a5f] flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 px-4 border border-[#1e3a5f] rounded-lg text-xs text-[#94a3b8] hover:text-[#e2e8f0] transition-colors">
            Отмена
          </button>
          <button
            onClick={() => { if (subscribers) onBuild(subscribers, settings, fileName, mode); }}
            disabled={!subscribers}
            className="flex-1 py-2 px-4 bg-[#38bdf8] hover:bg-[#7dd3fc] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold text-[#0a0e1a] transition-colors"
          >
            {mode === 'append' ? '➕ Добавить и построить' : '🚀 Построить сеть'}
          </button>
        </div>
      </div>
    </div>
  );
}
