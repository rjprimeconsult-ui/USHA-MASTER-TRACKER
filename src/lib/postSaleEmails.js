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

// Sender identity — per-agent override for the From line of outbound
// emails. When set, /api/email/send uses these values instead of the
// global RESEND_FROM_ADDRESS env var, AND sets Reply-To to fromAddress
// (so customer replies land in that agent's actual inbox).
//
// Stored alongside the templates bundle under its own user_kv key so
// the data is portable + cloud-synced. The address MUST be on a domain
// that's verified in Resend — otherwise sends fail with a 5xx from
// Resend. (We don't validate against Resend client-side; admins
// verify domains in the Resend dashboard out-of-band.)
export const SENDER_IDENTITY_KEY = 'email_sender_identity_v1';

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

// Default body text for the polished HTML post-sale template. The
// HTML shell (banner, policy info card, verification card, referral
// card, signature, footer) is rendered server-side around this text —
// agents only edit the wording here, not the structure.
const DEFAULT_HTML_BODY = `Hi {customer_first_name},

It was a pleasure helping you find a new individual health insurance plan. I would like to thank you for your business. I believe we accomplished the goals at hand in building a policy that will work well for you. I want to assure you I am available should you have any questions or request any changes in coverage.

You will receive an email from the company with a link to your completed application and the product brochure. If you do not, let me know and I will send them to you.`;

export const DEFAULT_WELCOME_TEMPLATE = () => ({
  id: newTemplateId(),
  name: 'Welcome email',
  subject: 'Welcome — your new policy is on its way, {customer_first_name}',
  body: DEFAULT_HTML_BODY,
  fromName: '',
  enabled: true,
  autoSendOnStage: null,
  // Polished HTML rendering (banner + policy card + signature shell).
  // Set false to revert to the legacy plain-text-with-<br> render.
  useHtmlRender: true,
  // Editable fields that flow into the HTML shell:
  verificationPhone: '',
  referralEnabled: true,
  referralText: '',           // empty → defaultReferralText() in postSaleHtml.js
  closingLine: 'Thank you for your business.',
  // Attach the "Dear Doctor Letter" PDF matching the lead's main
  // product when one exists. Set false to never attach.
  attachDearDoctorPdf: true,
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

// Detects the unmigrated legacy "USHEALTH"-branded welcome template
// shipped before 2026-05-15. Agents who never customized their
// template (or only have the pre-launch default) should silently
// auto-upgrade to the new neutral HTML version on next load.
//
// Detection is intentionally generous — subject OR body mentioning
// USHEALTH/USHA is enough. Agents who have already moved away from
// the USHA branding in their own copy keep their work.
function looksLikeLegacyUshealthDefault(t) {
  const subject = String(t?.subject || '').toLowerCase();
  const body = String(t?.body || '').toLowerCase();
  if (subject.includes('ushealth')) return true;
  if (body.includes('thank you for choosing ushealth')) return true;
  if (body.includes('ushealth advisors')) return true;
  return false;
}

function normalizeTemplate(t) {
  // Auto-migrate the legacy "USHEALTH" default to the new neutral
  // HTML template. Preserves the template's id + per-agent settings
  // (enabled, autoSendOnStage, fromName) so any existing auto-send
  // wiring keeps working. Body + subject get replaced with the
  // approved neutral wording + HTML layout enabled by default.
  if (looksLikeLegacyUshealthDefault(t)) {
    const migrated = DEFAULT_WELCOME_TEMPLATE();
    return {
      ...migrated,
      id: t?.id || migrated.id,
      enabled: t?.enabled !== false,
      autoSendOnStage: typeof t?.autoSendOnStage === 'string' && AUTO_SEND_STAGES.includes(t.autoSendOnStage)
        ? t.autoSendOnStage
        : null,
      fromName: typeof t?.fromName === 'string' ? t.fromName : '',
      // Preserve verification phone if the agent already set one
      // post-migration (defensive — shouldn't exist on legacy rows
      // but won't hurt to carry forward if present).
      verificationPhone: typeof t?.verificationPhone === 'string' && t.verificationPhone
        ? t.verificationPhone
        : migrated.verificationPhone,
    };
  }
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
    // HTML render + per-template extras. New templates default these
    // on; legacy plain-text templates (non-USHEALTH ones the agent
    // customized) keep their existing behavior — useHtmlRender stays
    // false unless explicitly enabled.
    useHtmlRender: t?.useHtmlRender === true,
    verificationPhone: typeof t?.verificationPhone === 'string' ? t.verificationPhone : '',
    referralEnabled: t?.referralEnabled !== false,
    referralText: typeof t?.referralText === 'string' ? t.referralText : '',
    closingLine: typeof t?.closingLine === 'string' ? t.closingLine : '',
    attachDearDoctorPdf: t?.attachDearDoctorPdf !== false,
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

// ---------- Sender identity (per-agent From override) ----------

export const DEFAULT_SENDER_IDENTITY = {
  fromName: '',
  fromAddress: '',
};

export async function loadSenderIdentity() {
  try {
    const raw = await storage.getItem(SENDER_IDENTITY_KEY);
    if (!raw) return { ...DEFAULT_SENDER_IDENTITY };
    const parsed = JSON.parse(raw);
    return {
      fromName: typeof parsed?.fromName === 'string' ? parsed.fromName : '',
      fromAddress: typeof parsed?.fromAddress === 'string' ? parsed.fromAddress : '',
    };
  } catch {
    return { ...DEFAULT_SENDER_IDENTITY };
  }
}

export async function saveSenderIdentity(identity) {
  const safe = {
    fromName: String(identity?.fromName || '').slice(0, 200),
    fromAddress: String(identity?.fromAddress || '').slice(0, 254).trim(),
  };
  await storage.setItem(SENDER_IDENTITY_KEY, JSON.stringify(safe));
  return safe;
}

export function isValidEmailAddress(s) {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
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
