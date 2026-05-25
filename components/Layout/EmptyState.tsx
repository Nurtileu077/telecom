'use client';
import { Upload, HelpCircle } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '@/lib/branding';

const STEPS = [
  { n: '1', title: 'Импорт', desc: 'Excel или KMZ с координатами' },
  { n: '2', title: 'Построение', desc: 'OLT, муфты, ОРК, кабели' },
  { n: '3', title: 'Маршрут', desc: 'OSRM по дорогам → слияние' },
];

export default function EmptyState({ onImport, onHelp }: { onImport: () => void; onHelp: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6 z-[400]">
      <div className="panel p-8 max-w-md w-full pointer-events-auto animate-fade-in">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--accent-dim)] flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M6 8c8 0 8 16 16 16" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" />
              <path d="M26 8c-8 0-8 16-16 16" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
              <circle cx="16" cy="16" r="2.5" fill="#2dd4bf" />
            </svg>
          </div>
        </div>
        <h2 className="text-xl font-bold text-center text-[var(--text)]">{APP_NAME}</h2>
        <p className="text-center text-sm text-[var(--text-2)] mt-1 mb-5">{APP_TAGLINE}</p>
        <div className="space-y-2 mb-6">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3 p-3 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border)]">
              <span className="stepper-dot done">{s.n}</span>
              <div>
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="text-xs text-[var(--text-muted)]">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-center">
          <button type="button" className="btn btn-primary" onClick={onImport}>
            <Upload size={16} /> Импорт
          </button>
          <button type="button" className="btn btn-secondary" onClick={onHelp}>
            <HelpCircle size={16} /> Справка
          </button>
        </div>
      </div>
    </div>
  );
}
