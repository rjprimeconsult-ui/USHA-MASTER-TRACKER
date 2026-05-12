/**
 * Post-sale email templates and helpers.
 *
 * Templates are stored per-agent in user_kv via the cloud storage adapter.
 * The bundle shape (key `post_sale_email_template_v1`) is:
 *
 *   {
 *     testMode: boolean,
 *     testAddresses: string,           // comma-separated emails
 *     templates: [
 *       {
 *         id:              string,
 *         name:            string,     // shown in lists / pickers
 *         subject:         string,
 *         body:            string,
 *         fromName:        string,     // optional From display name
 *         enabled:         boolean,    // false = don't show in send picker
 *         autoSendOnStage: string|null // when set, fire auto-send when a lead's
 *                                      // stage changes to this value (with a
 *                                      // grace window the agent can cancel)
 *       },
 *       ...
 *     ]
 *   }
 *
 * Backwards compat: an older single-template shape ({subject, body, ...} at
 * the root) is auto-migrated on first load. The first time the new shape
 * saves, the old fields disappear cleanly.
 *
 * Test mode (default ON during beta): when on, recipients are silently
 * redirected to the testAddresses array regardless of what's on the lead.
 * Production sends only go through when test mode is explicitly off.
 */

import { storage } from './storage';

export const TEMPLATE_KEY = 'post_sale_email_template_v1';

// Lead stages that can trigger an auto-send. Mirrors src/lib/constants.js
// STAGES but kept lightweight here so we don't pull in unrelated config.
export const AUTO_SEND_STAGES = ['Pending', 'Issued', 'Declined', 'Not taken', 'Withdrawn'];

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

// ---------- ID generation ----------

function newTemplateId() {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- Default content ----------

export const DEFAULT_WELCOME_TEMPLATE = () => ({
  id: newTemplateId(),
  name: 'Welcome email',
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
  fromName: '',
  enabled: true,
  autoSendOnStage: null,
});

export const DEFAULT_BUNDLE = () => ({
  testMode: true,
  testAddresses: '',
  templates: [DEFAULT_WELCOME_TEMPLATE()],
});

// ---------- Storage ----------

/**
 * Read the template bundle. Migrates the legacy single-template shape
 * automatically — old saves that had {subject, body, fromName, enabled,
 * testMode, testAddresses} at the root get wrapped into templates[0].
 */
export async function loadBundle() {
  try {
    const raw = await storage.getItem(TEMPLATE_KEY);
    if (!raw) return DEFAULT_BUNDLE();
    const parsed = JSON.parse(raw);
    // Already in the new shape
    if (Array.isArray(parsed?.templates)) {
      return {
        testMode: parsed.testMode !== false,
        testAddresses: typeof parsed.testAddresses === 'string' ? parsed.testAddresses : '',
        templates: parsed.templates.length > 0
          ? parsed.templates.map(normalizeTemplate)
          : [DEFAULT_WELCOME_TEMPLATE()],
      };
    }
    // Legacy single-template shape
    if (parsed && (parsed.subject || parsed.body)) {
      return {
        testMode: parsed.testMode !== false,
        testAddresses: typeof parsed.testAddresses === 'string' ? parsed.testAddresses : '',
        templates: [normalizeTemplate({
          id: newTemplateId(),
          name: 'Welcome email',
          subject: parsed.subject || '',
          body: parsed.body || '',
          fromName: parsed.fromName || '',
          enabled: parsed.enabled !== false,
          autoSendOnStage: null,
        })],
      };
    }
    return DEFAULT_BUNDLE();
  } catch {
    return DEFAULT_BUNDLE();
  }
}

function normalizeTemplate(t) {
  return {
    id: t?.id || newTemplateId(),
    name: typeof t?.name === 'string' && t.name.trim() ? t.name : 'Untitled template',
    subject: typeof t?.subject === 'string' ? t.subject : '',
    body: typeof t?.body === 'string' ? t.body : '',
    fromName: typeof t?.fromName === 'string' ? t.fromName : '',
    enabled: t?.enabled !== false,
    autoSendOnStage: typeof t?.autoSendOnStage === 'string' && AUTO_SEND_STAGES.includes(t.autoSendOnStage)
      ? t.autoSendOnStage
      : null,
  };
}

export async function saveBundle(bundle) {
  const safe = {
    testMode: bundle?.testMode !== false,
    testAddresses: typeof bundle?.testAddresses === 'string' ? bundle.testAddresses : '',
    templates: Array.isArray(bundle?.templates) && bundle.templates.length > 0
      ? bundle.templates.map(normalizeTemplate)
      : [DEFAULT_WELCOME_TEMPLATE()],
  };
  await storage.setItem(TEMPLATE_KEY, JSON.stringify(safe));
  return safe;
}

// ---------- Render ----------

function substitute(str, values) {
  if (typeof str !== 'string') return '';
  return str.replace(/\{(\w+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key] ?? '');
    }
    return m; // leave unknown tokens visible so typos are obvious
  });
}

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
 * Render a template against a lead and bundle context.
 *
 * recipient resolution:
 *   - If testMode is on and testAddresses has entries, returns the first
 *     test address as the real recipient.
 *   - Otherwise returns the lead's email.
 */
export function renderTemplate(template, lead, agentProfile, bundle = {}, opts = {}) {
  const tmpl = normalizeTemplate(template || {});
  const values = buildSubstitutions(lead, agentProfile, opts);
  const subject = substitute(tmpl.subject, values);
  const body = substitute(tmpl.body, values);

  let recipient = (lead?.email || '').trim();
  const testList = parseTestAddresses(bundle.testAddresses);
  if (bundle.testMode !== false && testList.length > 0) {
    recipient = testList[0];
  }

  return {
    subject,
    body,
    recipient,
    intendedRecipient: (lead?.email || '').trim(),
    testMode: bundle.testMode !== false,
    testList,
    templateId: tmpl.id,
    templateName: tmpl.name,
  };
}

export function parseTestAddresses(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,\s;]+/)
    .map(s => s.trim())
    .filter(s => /.+@.+\..+/.test(s));
}

export function findMissingValues(rendered) {
  const found = new Set();
  const re = /\{(\w+)\}/g;
  const texts = [rendered.subject || '', rendered.body || ''];
  for (const t of texts) {
    let m;
    while ((m = re.exec(t)) !== null) found.add(m[0]);
  }
  return [...found];
}

// ---------- Public helpers for callers (Settings UI, send button) ----------

/**
 * Returns the template that should auto-send when a lead's stage changes
 * to `targetStage`. Returns null when no template is configured for that
 * stage or when nothing is enabled.
 */
export function findAutoSendTemplate(bundle, targetStage) {
  if (!bundle || !targetStage) return null;
  for (const t of bundle.templates || []) {
    if (t.enabled !== false && t.autoSendOnStage === targetStage) return t;
  }
  return null;
}

export function createBlankTemplate() {
  return {
    id: newTemplateId(),
    name: 'New template',
    subject: '',
    body: '',
    fromName: '',
    enabled: true,
    autoSendOnStage: null,
  };
}

/**
 * Append a new audit log entry to a lead. Returns the patched lead.
 * Caller is responsible for persisting via the regular onSave path.
 */
export function appendAuditEntry(lead, entry) {
  const existing = Array.isArray(lead?.emailLog) ? lead.emailLog : [];
  return { ...lead, emailLog: [...existing, entry] };
}
