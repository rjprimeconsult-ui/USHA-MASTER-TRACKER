/**
 * Streaming chat endpoint for the in-app PRIM assistant.
 *
 * Body: {
 *   messages:    [{ role: 'user' | 'assistant', content: string | array }, ...]
 *   userContext: { ...lightweight pre-computed snapshot... }
 *   attachments: [{ type: 'image'|'document', mediaType, base64 }]   optional
 *   language:    'en' | 'es'                                          optional
 * }
 *
 * Authorization: optional Bearer <supabase access token>. When present,
 * the assistant gains access to the read-only tool set in chatTools.js
 * (searchLeads, getExpenseTotals, getImportHistory, getSubscriptionStatus,
 * getVendorMemory, getStatementGaps). Without auth the model can still
 * chat from its system prompt + the lightweight userContext snapshot.
 *
 * Streams Server-Sent Events with payloads:
 *   { type: 'text', text }        — text delta from the model
 *   { type: 'tool_use', name }    — model is calling a tool
 *   { type: 'done', usage }       — final usage stats
 *   { type: 'error', error }      — fatal error
 *
 * Required env: ANTHROPIC_API_KEY, SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (for tool reads).
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { PRIM_SYSTEM_PROMPT, renderUserContext } from '@/lib/chatPrompt';
import { CHAT_TOOLS, runChatTool } from '@/lib/chatTools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Try to verify the bearer token and return userId. Returns null when
// missing/invalid — the route still functions, tools just won't run.
async function authenticate(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  try {
    const supabase = createClient(url, anonKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'Chat is not configured. Set ANTHROPIC_API_KEY in Vercel env vars.' }, { status: 503 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { messages, userContext, attachments, language } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages[] required' }, { status: 400 });
  }

  // Sanitize messages — drop empty, enforce that the first turn is user.
  // We accept either string content (typical) or array content (when the
  // turn includes images / documents from a previous attachment).
  const sanitized = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .filter(m => {
      if (typeof m.content === 'string') return m.content.length > 0;
      return Array.isArray(m.content) && m.content.length > 0;
    })
    .map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? String(m.content).slice(0, 8000) : m.content,
    }));
  if (sanitized.length === 0 || sanitized[0].role !== 'user') {
    return Response.json({ error: 'first message must be user' }, { status: 400 });
  }

  // If attachments came in this request, append them to the latest user
  // turn so Claude can analyze them. We do this server-side rather than
  // client-side to keep the message shape the model expects in one place.
  if (Array.isArray(attachments) && attachments.length > 0) {
    const lastIdx = sanitized.length - 1;
    if (sanitized[lastIdx].role === 'user') {
      const existing = sanitized[lastIdx].content;
      const textBlock = typeof existing === 'string'
        ? [{ type: 'text', text: existing || '(file attached)' }]
        : existing;
      const imageBlocks = attachments.slice(0, 5).map(a => {
        if (a.type === 'document') {
          return {
            type: 'document',
            source: { type: 'base64', media_type: a.mediaType || 'application/pdf', data: a.base64 },
          };
        }
        return {
          type: 'image',
          source: { type: 'base64', media_type: a.mediaType || 'image/png', data: a.base64 },
        };
      });
      sanitized[lastIdx] = { role: 'user', content: [...imageBlocks, ...textBlock] };
    }
  }

  // Auth — gates tool use. No token = no tools but chat still works.
  const userId = await authenticate(req);
  const serviceClient = userId ? getServiceClient() : null;
  const toolsEnabled = !!(userId && serviceClient);

  // System prompt — adds tool usage instructions when tools are wired up
  // and a Spanish hint when the client requested language='es'.
  const ctxText = renderUserContext(userContext || {});
  const langSuffix = language === 'es'
    ? '\n\nLANGUAGE: Respond in clear, conversational Spanish unless the user asks otherwise. Keep technical terms (Smart Import, Books, True CPA, etc.) in English where they\'re proper nouns of the app.'
    : '';
  const toolsSuffix = toolsEnabled
    ? '\n\nTOOLS: You have read-only tools (searchLeads, getExpenseTotals, getImportHistory, getSubscriptionStatus, getVendorMemory, getStatementGaps). Call them whenever the user asks a specific data question instead of guessing or asking them to look. Don\'t announce that you\'re calling a tool — just use the result naturally in your reply.'
    : '\n\nTOOLS: Read-only data tools are not available in this session (user not signed in). Answer from the system prompt + their context block only.';

  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        // Tool-use loop. Each iteration sends the conversation to Claude;
        // when the model wants a tool, we run it and feed the result back.
        // Hard-cap iterations to prevent runaway loops (model errors).
        let conversation = sanitized;
        let totalInputTokens = 0;
        let totalCachedReadTokens = 0;
        let totalOutputTokens = 0;
        const MAX_ROUNDS = 5;

        for (let round = 0; round < MAX_ROUNDS; round++) {
          const claudeStream = client.messages.stream({
            model: 'claude-haiku-4-5',
            max_tokens: 2000,
            system: [
              { type: 'text', text: PRIM_SYSTEM_PROMPT + toolsSuffix + langSuffix, cache_control: { type: 'ephemeral' } },
              ...(ctxText ? [{ type: 'text', text: ctxText, cache_control: { type: 'ephemeral' } }] : []),
            ],
            messages: conversation,
            ...(toolsEnabled ? { tools: CHAT_TOOLS } : {}),
          });

          for await (const event of claudeStream) {
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              send({ type: 'text', text: event.delta.text });
            } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              // Surface "consulting your data..." status to the client
              send({ type: 'tool_use', name: event.content_block.name });
            }
          }

          const final = await claudeStream.finalMessage();
          totalInputTokens += final.usage.input_tokens || 0;
          totalCachedReadTokens += final.usage.cache_read_input_tokens || 0;
          totalOutputTokens += final.usage.output_tokens || 0;

          // No tool calls? We're done — the model finished a turn.
          if (final.stop_reason !== 'tool_use') break;

          // Run every tool_use block, send results back, continue the loop.
          const toolUses = final.content.filter(b => b.type === 'tool_use');
          const toolResults = await Promise.all(
            toolUses.map(async (tu) => ({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(
                await runChatTool({ name: tu.name, args: tu.input, userId, supabase: serviceClient })
              ).slice(0, 12000), // hard cap so a runaway result doesn't blow context
            }))
          );

          conversation = [
            ...conversation,
            { role: 'assistant', content: final.content },
            { role: 'user', content: toolResults },
          ];
        }

        send({
          type: 'done',
          usage: {
            inputTokens: totalInputTokens,
            cachedReadTokens: totalCachedReadTokens,
            outputTokens: totalOutputTokens,
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
