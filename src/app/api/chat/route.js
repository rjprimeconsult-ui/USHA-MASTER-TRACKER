/**
 * Streaming chat endpoint for the in-app PRIM assistant.
 *
 * Body: {
 *   messages: [{ role: 'user' | 'assistant', content: string }, ...],
 *   userContext: {
 *     email, tier, currentView, leadsCount, leadsByStage,
 *     prospectsCount, todayAppointments,
 *     kpis: { earnedYTD, totalRevenueYTD, expensesYTD, netYTD, trueCpa },
 *     recentLeads: [...], recentBooksExpenses: [...],
 *   }
 * }
 *
 * Returns SSE stream of text deltas. Client reads line-by-line.
 *
 * Required env: ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import { PRIM_SYSTEM_PROMPT, renderUserContext } from '@/lib/chatPrompt';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: 'Chat is not configured. Set ANTHROPIC_API_KEY in Vercel env vars.',
    }, { status: 503 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { messages, userContext } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages[] required' }, { status: 400 });
  }

  // Sanitize messages — drop empty content, enforce role alternation
  const sanitized = messages
    .filter(m => m && m.content && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
  if (sanitized.length === 0 || sanitized[0].role !== 'user') {
    return Response.json({ error: 'first message must be user' }, { status: 400 });
  }

  const ctxText = renderUserContext(userContext || {});

  const client = new Anthropic({ apiKey });

  // Stream the response and proxy as SSE to the client
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const claudeStream = client.messages.stream({
          model: 'claude-haiku-4-5',
          max_tokens: 2000,
          // Cache system prompt + user-context block so repeat turns in the same
          // session cost ~0.1× input tokens.
          system: [
            { type: 'text', text: PRIM_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
            ...(ctxText ? [{ type: 'text', text: ctxText, cache_control: { type: 'ephemeral' } }] : []),
          ],
          messages: sanitized,
        });

        for await (const event of claudeStream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            send({ type: 'text', text: event.delta.text });
          }
        }

        const final = await claudeStream.finalMessage();
        send({
          type: 'done',
          usage: {
            inputTokens: final.usage.input_tokens,
            cachedReadTokens: final.usage.cache_read_input_tokens || 0,
            outputTokens: final.usage.output_tokens,
          },
        });
        controller.close();
      } catch (e) {
        console.error('[chat] streaming error:', e);
        send({ type: 'error', error: e?.message || String(e) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
