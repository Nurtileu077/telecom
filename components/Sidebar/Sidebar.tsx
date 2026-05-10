'use client';
import { useState } from 'react';
import { District, Cable, Materials, LayerVisibility, ValidationIssue } from '@/types/network';
import LayersTab from './LayersTab';
import MaterialsTab from './MaterialsTab';
import SchemaTab from './SchemaTab';
import GroupsTab from './GroupsTab';

interface Props {
  districts: District[];
  cables: Cable[];
  materials: Materials | null;
  layers: LayerVisibility;
  toggleLayer: (key: keyof LayerVisibility) => void;
  validationIssues: ValidationIssue[];
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
}

type Tab = 'layers' | 'materials' | 'schema' | 'groups';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'layers', label: 'Слои', icon: '🗂' },
  { id: 'materials', label: 'Материалы', icon: '📦' },
  { id: 'schema', label: 'Схема', icon: '🌳' },
  { id: 'groups', label: 'Группы', icon: '👥' },
];

export default function Sidebar({ districts, cables, materials, layers, toggleLayer, validationIssues, flyTo }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('layers');

  return (
    <aside className="w-[300px] flex-shrink-0 bg-[#0d1b2a] border-r border-[#1e3a5f] flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-[#1e3a5f] p-1 gap-0.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-1.5 px-1 text-[10px] font-medium rounded transition-all duration-200 flex flex-col items-center gap-0.5 ${
              activeTab === tab.id
                ? 'bg-[#38bdf8]/10 text-[#38bdf8]'
                : 'text-[#64748b] hover:text-[#94a3b8] hover:bg-[#1a2744]/40'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Validation badge */}
      {validationIssues.length > 0 && (
        <div className="mx-2 mt-2 px-2 py-1 bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-md">
          <p className="text-[10px] text-[#f59e0b]">
            ⚠️ {validationIssues.length} предупреждений сети
          </p>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'layers' && (
          <LayersTab districts={districts} layers={layers} toggleLayer={toggleLayer} />
        )}
        {activeTab === 'materials' && (
          <MaterialsTab materials={materials} districts={districts} cables={cables} />
        )}
        {activeTab === 'schema' && (
          <SchemaTab districts={districts} flyTo={flyTo} />
        )}
        {activeTab === 'groups' && (
          <GroupsTab districts={districts} flyTo={flyTo} />
        )}
      </div>
    </aside>
  );
}
