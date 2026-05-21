'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { executeTool, networkSummary, type NetForExecutor, type FlyToFn } from './executor';
import type { AITool } from './tools';

interface Props {
  net: NetForExecutor;
  flyTo: FlyToFn | null;
  onClose: () => void;
}

// Message shape mirrors what we send to /api/chat — either a plain text
// content or an array of typed blocks (tool_use / tool_result / text).
interface TextBlock { type: 'text'; text: string }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string }
type Block = TextBlock | ToolUseBlock | ToolResultBlock;

interface Msg {
  role: 'user' | 'assistant';
  blocks?: Block[];
  content?: string;
}

const RULES_KEY = 'ai-user-rules-v1';

export default function ChatPanel({ net, flyTo, onClose }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [userRules, setUserRules] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const netRef = useRef(net);
  const flyToRef = useRef(flyTo);
  const rulesRef = useRef('');
  netRef.current = net;
  flyToRef.current = flyTo;
  rulesRef.current = userRules;

  // Load rules from localStorage on first mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RULES_KEY);
      if (stored) setUserRules(stored);
    } catch { /* private mode etc — ignore */ }
  }, []);

  // Persist on change.
  useEffect(() => {
    try { window.localStorage.setItem(RULES_KEY, userRules); } catch {}
  }, [userRules]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // One round-trip = POST messages to /api/chat → if assistant returned tool_use
  // blocks, execute them client-side and POST again with tool_result blocks.
  // Loops until the assistant returns end_turn.
  const runConversation = useCallback(async (history: Msg[]) => {
    setBusy(true);
    setError('');
    let cur = history;
    try {
      // Cap so a runaway tool loop can't burn through the API budget.
      for (let step = 0; step < 6; step++) {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: cur,
            networkSummary: networkSummary(netRef.current.districts, netRef.current.cables),
            userRules: rulesRef.current,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        const assistantBlocks: Block[] = data.content ?? [];
        const assistantMsg: Msg = { role: 'assistant', blocks: assistantBlocks };
        cur = [...cur, assistantMsg];
        setMessages(cur);

        if (data.stop_reason !== 'tool_use') break;

        // Execute each tool_use block locally.
        const toolResults: Block[] = [];
        for (const blk of assistantBlocks) {
          if (blk.type !== 'tool_use') continue;
          const result = await executeTool(
            { name: blk.name, input: blk.input } as AITool,
            netRef.current,
            flyToRef.current,
          );
          toolResults.push({ type: 'tool_result', tool_use_id: blk.id, content: result });
        }
        const userMsg: Msg = { role: 'user', blocks: toolResults };
        cur = [...cur, userMsg];
        setMessages(cur);
      }
    } catch (e: any) {
      setError(e?.message ?? 'unknown error');
    } finally {
      setBusy(false);
    }
  }, []);

  const send = useCallback(async () => {
    const txt = input.trim();
    if (!txt || busy) return;
    setInput('');
    const next: Msg[] = [...messages, { role: 'user', content: txt }];
    setMessages(next);
    await runConversation(next);
  }, [input, busy, messages, runConversation]);

  return (
    <div className="fixed right-4 top-[72px] bottom-4 w-[400px] z-[9000] flex flex-col inspector max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between p-3 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--text)]">Ассистент OPTIQ</h2>
          <span className="text-[10px] text-[var(--text-muted)] font-mono">claude-sonnet-4-6</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowRules((s) => !s)}
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${showRules ? 'bg-[#fbbf24]/15 border-[#fbbf24]/40 text-[#fbbf24]' : 'border-[#1e3a5f] text-[#64748b] hover:text-[#e2e8f0]'}`}
            title="Постоянные правила (обучение ассистента)"
          >
            📝 Правила{userRules.trim() ? ` (${userRules.trim().split(/\n+/).length})` : ''}
          </button>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0] transition-colors text-lg leading-none ml-1">
            ✕
          </button>
        </div>
      </div>

      {showRules && (
        <div className="border-b border-[#1e3a5f] bg-[#0a0e1a] p-3 space-y-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-[#fbbf24]">📝 Постоянные правила</h3>
            <span className="text-[9px] text-[#64748b]">сохраняется локально</span>
          </div>
          <p className="text-[10px] text-[#64748b] leading-snug">
            Пиши инструкции, которые ассистент должен выполнять всегда. Они подмешиваются в системный промпт каждому запросу.
          </p>
          <textarea
            value={userRules}
            onChange={(e) => setUserRules(e.target.value)}
            rows={7}
            placeholder={'• OK-96 не использовать никогда\n• После добавления абонента беги reconsolidate\n• OLT всегда на ближайший перекрёсток\n• Кабели тянуть только по дорогам, не диагональю'}
            className="w-full bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1.5 text-[11px] text-[#e2e8f0] font-mono leading-snug resize-none focus:outline-none focus:border-[#fbbf24]"
          />
          <div className="flex justify-between items-center text-[10px]">
            <button onClick={() => { if (confirm('Очистить все правила?')) setUserRules(''); }} className="text-[#64748b] hover:text-[#f87171] transition-colors">
              Очистить
            </button>
            <span className="text-[#64748b]">{userRules.length} символов</span>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-[11px] text-[#64748b] space-y-2">
            <p>Опиши что сделать — я выполню. Примеры:</p>
            <ul className="space-y-1 pl-3">
              <li>• «Покажи карту 43.32, 68.31»</li>
              <li>• «Сколько OLT в Туркестане?»</li>
              <li>• «Поставь абонента на 43.30, 68.27»</li>
              <li>• «Найди ОРК-Тур-3 и протяни к нему кабель от Муфта-Тур-1»</li>
              <li>• «Объедини кабели на общих дорогах»</li>
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-[#38bdf8]/15 border border-[#38bdf8]/40 text-[#e2e8f0]'
                  : 'bg-[#0a0e1a] border border-[#1e3a5f] text-[#cbd5e1]'
              }`}
            >
              {m.content && <span>{m.content}</span>}
              {m.blocks?.map((b, j) => (
                <span key={j}>
                  {b.type === 'text' && b.text}
                  {b.type === 'tool_use' && (
                    <span className="block text-[10px] font-mono text-[#94a3b8] mt-1">
                      🔧 {b.name}({Object.entries((b.input as Record<string, unknown>) ?? {}).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${String(v).slice(0, 40)}"` : v}`).join(', ')})
                    </span>
                  )}
                  {b.type === 'tool_result' && (
                    <span className="block text-[10px] font-mono text-[#64748b] mt-1 italic">
                      ↳ {b.content.length > 200 ? b.content.slice(0, 200) + '…' : b.content}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-[#64748b]">
            <div className="w-3 h-3 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
            Думает…
          </div>
        )}
        {error && (
          <div className="text-[11px] text-[#f87171] bg-[#f87171]/10 border border-[#f87171]/30 rounded px-2 py-1.5">
            ⚠️ {error}
            {error.includes('ANTHROPIC_API_KEY') && (
              <div className="mt-1 text-[10px] text-[#94a3b8]">
                В Vercel → Project → Settings → Environment Variables добавь<br/>
                <code>ANTHROPIC_API_KEY = sk-ant-…</code><br/>
                и сделай Redeploy.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-[#1e3a5f] p-2 flex-shrink-0">
        <div className="flex gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Что сделать?"
            disabled={busy}
            className="flex-1 bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-[12px] text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8] disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="px-3 py-1.5 bg-[#38bdf8] hover:bg-[#7dd3fc] disabled:opacity-30 disabled:cursor-not-allowed rounded text-[12px] font-semibold text-[#0a0e1a] transition-colors"
          >
            ↵
          </button>
        </div>
      </div>
    </div>
  );
}
