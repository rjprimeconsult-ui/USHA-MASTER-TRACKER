// Pure, server-safe logic for the support-ticket feature. No secrets, no I/O.
//
// The submit-email builder DELIBERATELY excludes the agent's free-text
// description: it may contain PHI, so it stays in Supabase (viewed only in the
// admin queue) and is never placed in an outbound email. `description` is not
// even a parameter of buildSubmitEmail — it structurally can't leak.

export const TICKET_CATEGORIES = ['Upload', 'Import', 'Login', 'Data looks wrong', 'Billing', 'Other', 'Custom'];

const SITE = 'https://www.primtracker.com';

export function validateTicketInput({ category, custom_category, description, context } = {}) {
  if (!TICKET_CATEGORIES.includes(category)) return { ok: false, error: 'Invalid category' };
  if (category === 'Custom') {
    const c = String(custom_category || '').trim();
    if (!c || c.length > 120) return { ok: false, error: 'Custom category required (max 120 chars)' };
  }
  const d = String(description || '').trim();
  if (d.length < 1 || d.length > 4000) return { ok: false, error: 'Description must be 1–4000 characters' };
  if (context != null) {
    try { if (JSON.stringify(context).length > 8192) return { ok: false, error: 'Context too large' }; }
    catch { return { ok: false, error: 'Invalid context' }; }
  }
  return { ok: true };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Submit notification → Juan. METADATA ONLY — never the description.
export function buildSubmitEmail({ id, category, custom_category, name, email, context = {} }) {
  const cat = category === 'Custom' ? `Custom: ${custom_category}` : category;
  const subject = `New PRIM ticket #${id} — ${cat} from ${name || email}`;
  const link = `${SITE}/admin?ticket=${id}`;
  const rows = [
    ['Ticket', `#${id}`], ['Category', cat], ['From', `${name || ''} <${email}>`],
    ['Screen', context.page || '—'], ['App', context.appVersion || '—'], ['When', context.ts || ''],
  ].map(([k, v]) => `<tr><td style="padding:2px 10px;color:#64748b">${esc(k)}</td><td style="padding:2px 10px">${esc(v)}</td></tr>`).join('');
  const html = `<div style="font-family:sans-serif"><p>A new support ticket was submitted.</p>`
    + `<table>${rows}</table>`
    + `<p><a href="${link}">Open ticket #${id} in the admin queue →</a></p>`
    + `<p style="color:#94a3b8;font-size:12px">The description is in the admin queue only (kept out of email).</p></div>`;
  const text = `New PRIM ticket #${id} — ${cat} from ${name || email}\nScreen: ${context.page || '—'} · App: ${context.appVersion || '—'}\nOpen the admin queue: ${link}\n(Description is in the admin queue, not this email.)`;
  return { subject, html, text };
}

// Resolution notification → agent. Only the human-written, PHI-safe resolution note.
export function buildResolutionEmail({ id, resolution }) {
  const subject = `Your PRIM report #${id} is resolved`;
  const note = esc(resolution || 'This has been resolved.');
  const html = `<div style="font-family:sans-serif"><p>Good news — your report <b>#${id}</b> has been resolved.</p><p>${note}</p><p style="color:#94a3b8;font-size:12px">— The PRIM team</p></div>`;
  const text = `Your PRIM report #${id} is resolved.\n\n${resolution || 'This has been resolved.'}\n\n— The PRIM team`;
  return { subject, html, text };
}
