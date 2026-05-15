import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { AI_TOOLS } from '@/components/AI/tools';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Ты — ассистент в редакторе GPON-сети.

Карта показывает существующую сеть: OLT (узлы связи), Муфты-TB, ОРК-шкафы, абонентов и кабели по дорогам.  Пользователь пишет тебе на русском или казахском.

ТВОЯ РОЛЬ:
- Помогаешь добавлять точки, тянуть кабели, искать объекты, делать перестроения.
- Если нужно — сам вызываешь инструменты.  Каждый инструмент мутирует сеть мгновенно.
- ВСЕГДА проверяй текущее состояние сети через list_entities / find_entity ПРЕЖДЕ чем выполнять connect_cable или delete_entity, иначе передашь несуществующий id.
- Координаты — десятичные градусы.  Казахстан: 40-55° N, 45-87° E.  Не выходи за эти границы без подтверждения.
- Если пользователь упоминает место по названию ("у мечети", "школа №12"), спроси координаты или используй find_entity — не угадывай.

СТИЛЬ:
- Краткие ответы на том языке, на котором пишет пользователь.
- После каждой выполненной операции — одна строчка отчёта типа "Поставил OLT в Туркестане на 43.32, 68.31".
- Если запрос неоднозначен — переспроси одной фразой.`;

interface ClientMessage {
  role: 'user' | 'assistant';
  // either plain text…
  content?: string;
  // …or full blocks (assistant turns with tool_use / tool_result)
  blocks?: Anthropic.Messages.ContentBlockParam[];
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not set on the server. Set it in Vercel env vars.' },
      { status: 500 },
    );
  }

  const body = (await req.json()) as {
    messages: ClientMessage[];
    networkSummary?: string;
  };

  const messages: Anthropic.Messages.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.blocks ?? m.content ?? '',
  }));

  const client = new Anthropic({ apiKey });

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: body.networkSummary
        ? `${SYSTEM_PROMPT}\n\nТекущая сеть:\n${body.networkSummary}`
        : SYSTEM_PROMPT,
      tools: AI_TOOLS as Anthropic.Messages.Tool[],
      messages,
    });

    return NextResponse.json({
      stop_reason: resp.stop_reason,
      content: resp.content,
    });
  } catch (err: any) {
    const msg = err?.error?.error?.message ?? err?.message ?? 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
