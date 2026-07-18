/**
 * Auto-announce a deploy to Slack — runs as `postbuild` on Vercel.
 *
 * It only posts when ALL of these are true, so routine internal deploys
 * never spam the channel:
 *   1. VERCEL_ENV === 'production'        (not preview / dev builds)
 *   2. SLACK_WEBHOOK_URL is set           (Slack is connected)
 *   3. the commit message contains [announce]  (you opted this deploy in)
 *
 * How to announce a deploy: put [announce] in the commit message, and
 * write the user-facing copy as:
 *     [announce] <Headline> | <Detail sentence(s)>
 * e.g.
 *     [announce] Payment Alerts are live | Get reminded before deals draft so you protect your Taken Rate. Find it on your CPA Dashboard.
 * The part before "|" becomes the bold headline; the part after is the body.
 * If there's no "|", the whole line (minus the tag) is the headline.
 *
 * SAFETY: this script can NEVER fail a build — every path resolves to a
 * clean exit 0. A broken announcement must not break a deploy.
 */

function log(...a) { console.log('[announce-deploy]', ...a); }

async function main() {
  const env = process.env.VERCEL_ENV || (process.env.VERCEL ? 'preview' : 'local');
  if (env !== 'production') { log(`skip: VERCEL_ENV=${env} (only production announces)`); return; }

  const webhook = (process.env.SLACK_WEBHOOK_URL || '').trim();
  if (!webhook.startsWith('https://hooks.slack.com/')) { log('skip: SLACK_WEBHOOK_URL not set'); return; }

  const rawMsg = (process.env.VERCEL_GIT_COMMIT_MESSAGE || '').trim();
  const subject = rawMsg.split('\n')[0].trim();
  if (!/\[announce\]/i.test(rawMsg)) { log('skip: commit not tagged [announce]'); return; }

  // Strip the tag, then split headline | body
  const cleaned = subject.replace(/\[announce\]/ig, '').trim();
  const [headRaw, ...bodyParts] = cleaned.split('|');
  const title = (headRaw || 'PRIM was updated').trim();
  const body = bodyParts.join('|').trim();

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `📣 *${title}*` } },
  ];
  if (body) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: body } });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `🔄 Refresh PRIM to get it · <${process.env.NEXT_PUBLIC_SITE_URL || 'https://app.primtracker.com'}|Open PRIM>` }],
  });

  const payload = {
    text: `📣 ${title}${body ? ` — ${body}` : ''}`,
    blocks,
    username: 'PRIM',
    icon_url: 'https://www.primtracker.com/prim-mark.png',
  };

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { log(`slack returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`); return; }
  log(`posted: "${title}"`);
}

main().catch((e) => log('error (ignored):', e?.message || e)).finally(() => process.exit(0));
