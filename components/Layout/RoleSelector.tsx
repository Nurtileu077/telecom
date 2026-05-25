'use client';
import { useState, useEffect } from 'react';
import type { UserRole } from '@/types/network';
import { USER_ROLE_LABELS } from '@/types/network';
import { getActorName, setActorName, setStoredRole } from '@/lib/appRole';

interface Props {
  role: UserRole;
  onRoleChange: (r: UserRole) => void;
  compact?: boolean;
}

export default function RoleSelector({ role, onRoleChange, compact }: Props) {
  const [name, setName] = useState('');
  const [showName, setShowName] = useState(false);

  useEffect(() => {
    setName(getActorName());
  }, []);

  const saveName = () => {
    setActorName(name);
    setShowName(false);
  };

  return (
    <div className={`flex items-center gap-1 shrink-0 ${compact ? '' : ''}`}>
      <select
        value={role}
        onChange={(e) => {
          const r = e.target.value as UserRole;
          setStoredRole(r);
          onRoleChange(r);
        }}
        className="input-optiq h-8 text-[10px] px-1.5 max-w-[100px]"
        title="Роль в системе"
        aria-label="Роль"
      >
        {(Object.keys(USER_ROLE_LABELS) as UserRole[]).map((r) => (
          <option key={r} value={r}>{USER_ROLE_LABELS[r]}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-ghost btn-icon h-8 w-8 text-[10px]"
        title="Имя для журнала"
        onClick={() => setShowName((v) => !v)}
      >
        👤
      </button>
      {showName && !compact && (
        <div className="absolute top-full right-0 mt-1 z-50 p-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-xl flex gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ФИО / бригада"
            className="input-optiq h-8 text-xs w-32"
          />
          <button type="button" className="btn btn-secondary text-[10px] py-1" onClick={saveName}>OK</button>
        </div>
      )}
    </div>
  );
}
