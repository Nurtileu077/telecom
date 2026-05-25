'use client';
import { useState, useEffect, useCallback } from 'react';
import { CatalogItem, CATEGORY_LABELS, CURRENCY_SYMBOLS, Currency } from '@/types/network';
import { dbListCatalog, dbUpsertCatalog, dbDeleteCatalog } from '@/lib/supabase';

interface Props {
  onClose: () => void;
}

const EMPTY: CatalogItem = {
  id: '', category: 'cable', article: '', name: '',
  unit: 'шт', price: 0, currency: 'KZT', vendor: '',
};

function newId() { return `cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export default function CatalogModal({ onClose }: Props) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(await dbListCatalog()); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (!editing) return;
    const item = { ...editing, id: editing.id || newId() };
    await dbUpsertCatalog(item);
    setEditing(null);
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить позицию из каталога?')) return;
    await dbDeleteCatalog(id);
    refresh();
  };

  const filtered = items.filter((i) => {
    if (filter !== 'all' && i.category !== filter) return false;
    if (search && !`${i.article} ${i.name} ${i.vendor}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="modal-sheet bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl w-[820px] max-h-[88vh] flex flex-col mx-2" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e3a5f]">
          <div>
            <h2 className="text-sm font-semibold text-[#e2e8f0]">📦 Каталог оборудования</h2>
            <p className="text-[10px] text-[#64748b]">{items.length} позиций · хранится в Supabase</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing({ ...EMPTY, id: newId() })}
              className="px-3 py-1.5 bg-[#38bdf8]/15 text-[#38bdf8] text-xs rounded hover:bg-[#38bdf8]/25 transition-colors"
            >
              + Добавить
            </button>
            <button onClick={onClose} className="text-[#64748b] hover:text-white text-lg px-1">×</button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1e3a5f] bg-[#0a0e1a]/50">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 поиск по артикулу / названию / вендору"
            className="flex-1 bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]"
          >
            <option value="all">Все категории</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {loading && <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-[#64748b] text-xs py-12">
              {items.length === 0 ? 'Пусто. Добавь первую позицию.' : 'Ничего не найдено.'}
            </div>
          )}
          {!loading && filtered.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-[#0a0e1a] text-[10px] text-[#64748b] uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left">Категория</th>
                  <th className="px-3 py-2 text-left">Артикул</th>
                  <th className="px-3 py-2 text-left">Наименование</th>
                  <th className="px-3 py-2 text-left">Вендор</th>
                  <th className="px-3 py-2 text-right">Цена</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e3a5f]">
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-[#1e293b]/30 group">
                    <td className="px-3 py-2 text-[#94a3b8]">{CATEGORY_LABELS[i.category]}</td>
                    <td className="px-3 py-2 font-mono text-[#94a3b8]">{i.article || '—'}</td>
                    <td className="px-3 py-2 text-[#e2e8f0]">{i.name}</td>
                    <td className="px-3 py-2 text-[#94a3b8]">{i.vendor || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#34d399]">
                      {i.price.toLocaleString('ru-RU')} {CURRENCY_SYMBOLS[i.currency]}/{i.unit}
                    </td>
                    <td className="px-3 py-2 text-right opacity-0 group-hover:opacity-100">
                      <button onClick={() => setEditing(i)} className="text-[#38bdf8] hover:text-[#7dd3fc] mr-2">✏️</button>
                      <button onClick={() => remove(i.id)} className="text-[#f87171] hover:text-red-400">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Edit form */}
        {editing && (
          <div className="border-t border-[#1e3a5f] p-4 bg-[#0a0e1a]">
            <div className="grid grid-cols-3 gap-2 mb-2">
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as any })} className="bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]">
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input value={editing.article} onChange={(e) => setEditing({ ...editing, article: e.target.value })} placeholder="Артикул" className="bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]" />
              <input value={editing.vendor} onChange={(e) => setEditing({ ...editing, vendor: e.target.value })} placeholder="Вендор" className="bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]" />
            </div>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Наименование" className="w-full mb-2 bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]" />
            <div className="grid grid-cols-4 gap-2 mb-2">
              <input type="number" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: +e.target.value })} placeholder="Цена" className="bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]" />
              <select value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value as Currency })} className="bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]">
                {Object.entries(CURRENCY_SYMBOLS).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}
              </select>
              <select value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value as any })} className="bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]">
                <option value="шт">шт</option>
                <option value="м">м</option>
                <option value="км">км</option>
                <option value="компл">компл</option>
              </select>
              <input value={editing.link ?? ''} onChange={(e) => setEditing({ ...editing, link: e.target.value })} placeholder="Ссылка" className="bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} className="flex-1 py-1.5 border border-[#1e3a5f] text-[#94a3b8] text-xs rounded">Отмена</button>
              <button onClick={save} disabled={!editing.name.trim()} className="flex-1 py-1.5 bg-[#34d399]/20 text-[#34d399] disabled:opacity-30 text-xs rounded hover:bg-[#34d399]/30">💾 Сохранить</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
