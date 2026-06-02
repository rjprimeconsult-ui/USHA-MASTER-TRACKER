/**
 * Server-only Slack helper. Posts messages to a Slack channel via an
 * Incoming Webhook URL (env: SLACK_WEBHOOK_URL).
 *
 * Set up the webhook once: Slack → your workspace → Apps → "Incoming
 * Webhooks" → Add to a channel (e.g. #announcements) → copy the URL into
 * the Vercel env var SLACK_WEBHOOK_URL. No webhook = these calls no-op
 * with a clear { ok:false } result instead of throwing.
 *
 * Do NOT import this into client components — the webhook URL is a secret.
 */

const WEBHOOK = (process.env.SLACK_WEBHOOK_URL || '').trim();

// Branding for the message author — overrides the Slack app's default avatar
// so posts show the PRIM prism logo + name. Incoming webhooks honor these.
const BOT_NAME = 'PRIM';
const ICON_URL = 'https://www.primtracker.com/prim-mark.png';

export function slackConfigured() {
  return WEBHOOK.startsWith('https://hooks.slack.com/');
}

/**
 * Post a message to Slack.
 *   text   — plain fallback text (always set; shown in notifications)
 *   blocks — optional Slack Block Kit array for richer formatting
 * Returns { ok, reason? }.
 */
export async function postToSlack({ text, blocks } = {}) {
  if (!slackConfigured()) return { ok: false, reason: 'not-configured' };
  if (!text && !blocks) return { ok: false, reason: 'empty' };

  try {
    const payload = blocks ? { text, blocks } : { text };
    payload.username = BOT_NAME;
    payload.icon_url = ICON_URL;
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: `slack-${res.status}`, detail: body.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'fetch-failed', detail: e?.message || String(e) };
  }
}

/**
 * Build a tidy announcement message (used by both the manual admin broadcast
 * and the auto deploy announcer so they look identical in the channel).
 */
export function announcementBlocks({ emoji = '📣', title, body, url }) {
  const heading = `${emoji} *${title}*`;
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: heading } },
  ];
  if (body) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: body } });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `🔄 Refresh PRIM to get it · <${url || 'https://www.primtracker.com'}|Open PRIM>` }],
  });
  return blocks;
}
