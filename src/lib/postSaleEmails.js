/**
 * Post-sale email templates and helpers.
 *
 * Templates are stored per-agent in user_kv via the cloud storage adapter
 * (same plumbing as expenses / vendor memory). One template per agent for
 * now — multiple templates + auto-send rules will land in a later iteration.
 *
 * The render pipeline is pure / synchronous: pass a template + a lead +
 * an agent profile, and you get back { subject, body } with all variables
 * substituted. The Send button + the email API route both use this so
 * preview-time and send-time rendering are guaranteed identical.
 *
 * Test mode (default ON during beta): when a template has testMode=true,
 * recipients are silently redirected to the testAddresses array regardless
 * of what's on the lead. Production sends only go through when test mode
 * is explicitly off.
 */

import { storage } from './storage';

export const TEMPLATE_KEY = 'post_sale_email_template_v1';

// Variables agents can drop into subject + body. The renderer is forgiving:
// unknown placeholders are left as-is so a typo is visible (not silently empty).
export const TEMPLATE_VARIABLES = [
  { token: '{customer_first_name}', label: 'Customer first name', sample: 'Sarah' },
  { token: '{customer_last_name}',  label: 'Customer last name',  sample: 'Johnson' },
  { token: '{customer_name}',       label: 'Customer full name',  sample: 'Sarah Johnson' },
  { token: '{main_product}',        label: 'Main product',        sample: 'PREMIER ADVANTAGE' },
  { token: '{association_plan}',    label: 'Association plan',    sample: 'EXECUTIVE DIAMOND' },
  { token: '{policy_number}',       label: 'Policy number',       sample: '72G216584S' },
  { token: '{effective_date}',      label: 'Effective date',      sample: '2026-05-15' },
  { token: '{agent_name}',          label: 'Agent (your) name',   sample: 'Juan Trejo' },
  { token: '{agent_email}',         label: 'Agent (your) email',  sample: 'agent@example.com' },
  { token: '{agent_phone}',         label: 'Agent (your) phone',  sample: '305-555-0100' },
];

export const DEFAULT_TEMPLATE = {
  enabled: true,
  subject: 'Welcome to USHEALTH, {customer_first_name} — quick next steps',
  body:
    `Hi {customer_first_name},\n\n` +
    `Thank you for choosing USHEALTH Advisors. Your {main_product} application is in motion, and I wanted to drop a quick note with what to expect next.\n\n` +
    `Policy number: {policy_number}\n` +
    `Effective: {effective_date}\n\n` +
    `If anything comes up — questions about coverage, ID cards, or claims — reach me directly:\n` +
    `  {agent_phone}\n` +
    `  {agent_email}\n\n` +
    `Welcome aboard,\n` +
    `{agent_name}`,
  fromName: '', // defaults to agent_name when empty
  testMode: true,
  testAddresses: '', // comma-separated; first one is the primary recipient
};

// ---------- Storage ----------

export async function loadTemplate() {
  try {
    const raw = await storage.getItem(TEMPLATE_KEY);
    if (!raw) return { ...DEFAULT_TEMPLATE };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_TEMPLATE, ...parsed };
  } catch {
    return { ...DEFAULT_TEMPLATE };
  }
}

export async function saveTemplate(template) {
  const next = { ...DEFAULT_TEMPLATE, ...template };
  await storage.setItem(TEMPLATE_KEY, JSON.stringify(next));
  return next;
}

// ---------- Render ----------

/**
 * Substitutes {variable} placeholders inside a string. Unknown placeholders
 * are left in the output verbatim so an agent immediately notices a typo.
 */
function substitute(str, values) {
  if (typeof str !== 'string') return '';
  return str.replace(/\{(\w+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key] ?? '');
    }
    return m; // leave unknown tokens visible
  });
}

/**
 * Builds the substitution map from a lead + agent profile + opts.
 * Helpers here pull from common lead fields (name, mainProduct, policyNumber,
 * effective/closed dates) and the agent's email/profile.
 */
export function buildSubstitutions(lead, agentProfile, opts = {}) {
  const fullName = String(lead?.name || '').trim();
  const [first, ...rest] = fullName.split(/\s+/);
  const last = rest.length ? rest.join(' ') : '';
  return {
    customer_first_name: first || '',
    customer_last_name:  last  || '',
    customer_name:       fullName || '',
    main_product:        lead?.mainProduct || '',
    association_plan:    lead?.associationPlan || '',
    policy_number:       lead?.policyNumber || '',
    effective_date:      lead?.effectiveDate || lead?.closedDate || lead?.dateAdded || '',
    agent_name:          opts.agentName || agentProfile?.fullName || (agentProfile?.email || '').split('@')[0] || '',
    agent_email:         agentProfile?.email || '',
    agent_phone:         opts.agentPhone || '',
  };
}

/**
 * Render a template against a lead. Returns { subject, body, recipient }.
 *
 * recipient resolution:
 *   - If testMode is on and testAddresses has entries, returns the first
 *     test address as the real recipient. Honest "would have sent to X"
 *     resolution.
 *   - Otherwise returns the lead's email.
 */
export function renderTemplate(template, lead, agentProfile, opts = {}) {
  const tmpl = { ...DEFAULT_TEMPLATE, ...(template || {}) };
  const values = buildSubstitutions(lead, agentProfile, opts);
  const subject = substitute(tmpl.subject, values);
  const body = substitute(tmpl.body, values);

  let recipient = (lead?.email || '').trim();
  const testList = parseTestAddresses(tmpl.testAddresses);
  if (tmpl.testMode && testList.length > 0) {
    recipient = testList[0];
  }

  return {
    subject,
    body,
    recipient,
    intendedRecipient: (lead?.email || '').trim(), // for "test mode redirected from X" UI
    testMode: !!tmpl.testMode,
    testList,
  };
}

export function parseTestAddresses(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,\s;]+/)
    .map(s => s.trim())
    .filter(s => /.+@.+\..+/.test(s));
}

/**
 * List of unresolved placeholders left in the rendered output. Used by the
 * preview UI to warn the agent before sending ("your template references
 * {main_product} but this lead has no mainProduct set").
 */
export function findMissingValues(rendered, lead) {
  const found = new Set();
  const re = /\{(\w+)\}/g;
  const texts = [rendered.subject || '', rendered.body || ''];
  for (const t of texts) {
    let m;
    while ((m = re.exec(t)) !== null) found.add(m[0]);
  }
  return [...found];
}
