'use client';
import {
  Link2, TreePine, School, Square, Tractor, Wrench, Wind, TowerControl, Flame,
  ClipboardList, TrendingUp, Handshake, FileCheck, Shield, Phone, AlertOctagon,
  ListTodo, HelpCircle,
} from 'lucide-react';
import { GLYPH_FALLBACK, type GlyphName } from '@/lib/glyphs';

/**
 * Значки одного набора вместо эмодзи.
 *
 * Эмодзи рисует система, и рисует по-своему: 🛠 на телефоне бригадира
 * цветной и объёмный, на компьютере в конторе — плоский и серый, а на
 * планшете постарше это вообще пустой прямоугольник. Рядом с ровными
 * линиями интерфейса такой значок выглядит наклейкой.
 *
 * Поэтому значок — рисунок из того же набора, что и всё остальное: один
 * вес линии, один размер, один цвет. А имя значка остаётся строкой в
 * справочниках: данные не должны знать о том, чем их рисуют.
 */

const GLYPHS: Record<GlyphName, typeof Link2> = {
  mufta: Link2,
  stolb: TreePine,
  endpoint: School,
  kks: Square,
  mkt: Tractor,
  gnb: Wrench,
  zaduvka: Wind,
  podves: TowerControl,
  svarka: Flame,
  office: ClipboardList,
  boss: TrendingUp,
  sub: Handshake,
  permit: FileCheck,
  clearance: Shield,
  contact: Phone,
  claim: AlertOctagon,
  task: ListTodo,
};

interface Props {
  name: string;
  size?: number;
  className?: string;
}

export default function Glyph({ name, size = 14, className }: Props) {
  const Icon = GLYPHS[name as GlyphName];
  // Незнакомое имя рисуем вопросом, а не пустотой: пустое место в ряду
  // значков читается как «здесь ничего нет», и это неправда.
  if (!Icon) {
    const emoji = GLYPH_FALLBACK[name as GlyphName];
    if (emoji) return <span className={className} aria-hidden>{emoji}</span>;
    return <HelpCircle size={size} className={className} aria-hidden />;
  }
  return <Icon size={size} className={className} aria-hidden />;
}
