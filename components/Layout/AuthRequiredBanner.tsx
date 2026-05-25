'use client';

import { Cloud } from 'lucide-react';
import AuthLoginForm from '@/components/Auth/AuthLoginForm';

interface Props {
  onOpenHeaderAuth?: () => void;
}

export default function AuthRequiredBanner({ onOpenHeaderAuth }: Props) {
  return (
    <div className="shrink-0 z-50 border-b border-[#38bdf8]/20 bg-[#0a0e1a]/95 backdrop-blur-sm">
      <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 shrink-0 lg:max-w-[280px]">
          <div className="w-10 h-10 rounded-xl bg-[#38bdf8]/12 border border-[#38bdf8]/25 flex items-center justify-center">
            <Cloud size={20} className="text-[#38bdf8]" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-[#e2e8f0] leading-tight">
              Вход в облако
            </p>
            <p className="text-[11px] text-[#64748b] mt-0.5 leading-snug">
              Сохранение проектов и работа в команде
            </p>
          </div>
        </div>

        <div className="flex-1 min-w-0 lg:pl-4 lg:border-l border-[#1e3a5f]/80">
          <AuthLoginForm compact onSuccess={onOpenHeaderAuth} />
        </div>
      </div>
    </div>
  );
}
