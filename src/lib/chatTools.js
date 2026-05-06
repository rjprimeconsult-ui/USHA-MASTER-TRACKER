/**
 * Read-only tools the PRIM chatbot can call to answer specific data
 * questions instead of guessing or asking the user to dig.
 *
 * Each tool has:
 *   - name (matches the Anthropic tool spec)
 *   - description (sent to the model — must explain when to use it)
 *   - input_schema (JSON Schema validated by Anthropic)
 *   - run({ userId, args, supabase }) — server-side handler
 *
 * Handlers are server-only (use the service-role Supabase client).
 * They return small, formatted text — short enough to keep tool-result
 * tokens minimal but rich enough that the model can answer cleanly.
 *
 * Auth invariant: the route gives us a verified `userId`. Every query
 * filters by that user. There is no path where a tool can read another
 * agent's data.
 */

// ===== Tool definitions (sent to Claude) =====

export const CHAT_TOOLS = [
  {
    name: 'searchLeads',
    description:
      'Search the CURRENT user\'s leads. Use this whenever they ask "show me my X leads", "how many Issued deals do I have", "find leads from May", or any question about specific leads in their tracker. Returns a list of matching leads with name, stage, product, source, age, advance, and dates.',
    input_schema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['Pending', 'Issued', 'Declined', 'Not taken', 'Withdrawn'],
          description: 'Filter by stage. Omit to include all stages.',
        },
        product: {
          type: 'string',
          description: 'Filter by mainProduct id, e.g. "PREMIER ADVANTAGE", "SECURE ADVANTAGE", "HEALTH ACCESS III".',
        },
        source: {
          type: 'string',
          description: 'Filter by lead source (e.g. "Referral", "Facebook", "CRM").',
        },
        leadCategory: {
          type: 'string',
          description: 'Filter by lead category (e.g. "AGED", "SHARED", "REFERRAL", "BENEPATH").',
        },
        crm: {
          type: 'string',
          description: 'Filter by CRM tag (e.g. "RINGY", "TEXTDRIP", "VANILLA", "BENEPATH").',
        },
        campaign: {
          type: 'string',
          description: 'Filter by campaign (e.g. "AGED.25", "AGED.50", "BENEPATH (BENNYS)").',
        },
        ageBucket: {
          type: 'string',
          enum: ['OVER_50', 'UNDER_50'],
          description: 'Over 50 or under 50. Mirrors the USHA senior-market line.',
        },
        dateFrom: { type: 'string', description: 'Inclusive lower bound on closedDate (YYYY-MM-DD).' },
        dateTo:   { type: 'string', description: 'Inclusive upper bound on closedDate (YYYY-MM-DD).' },
        limit: { type: 'integer', description: 'Max results to return (default 25, max 100).' },
      },
    },
  },
  {
    name: 'getExpenseTotals',
    description:
      'Sum the user\'s Books + Platform expenses by category over a period. Use when they ask "how much did I spend on X", "what\'s my marketing total this year", "expenses by category", or "expenses for January". For a specific month, pass dateFrom and dateTo (e.g. January 2026 = 2026-01-01 / 2026-01-31). For broad periods, pass `period`. Returns books_total, platforms_total, grand_total, and a per-category breakdown.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Single category id to filter to (e.g. "MARKETING", "LEAD_INVESTMENT", "SOFTWARE"). Omit to get a per-category breakdown of all categories.',
        },
        period: {
          type: 'string',
          enum: ['ytd', 'mtd', 'last30', 'last90', 'last365', 'all'],
          description: 'Period to total over. Default "ytd".',
        },
        dateFrom: { type: 'string', description: 'Custom lower bound (YYYY-MM-DD). Overrides period if set.' },
        dateTo:   { type: 'string', description: 'Custom upper bound (YYYY-MM-DD). Overrides period if set.' },
      },
    },
  },
  {
    name: 'getImportHistory',
    description:
      'Read the user\'s recent Smart Import history. Use when they say "my import failed", "why didn\'t my file work", "what did I import last week". Returns the most recent imports with filename, status, row counts, error messages, and token usage. Critical for diagnosing bank statement / lead import failures.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'Filter by kind: "expenses", "leads", "prospects", or any *-error variant. Omit for all.',
        },
        limit: { type: 'integer', description: 'How many recent entries (default 10, max 25).' },
        onlyErrors: { type: 'boolean', description: 'Set true to return only failed imports.' },
      },
    },
  },
  {
    name: 'getSubscriptionStatus',
    description:
      'Read the user\'s current PRIM subscription. Use when they ask "what plan am I on", "how many days left in trial", "when does my subscription renew", or any billing question. Returns tier, status, trial end date, current period end, and complimentary flag.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getVendorMemory',
    description:
      'Read the user\'s saved vendor → category mappings. Use when they ask "what did I tag X as", "show me my vendor memory", "what does PRIM remember for my expenses". Returns vendor mappings with the categories they\'re routed to.',
    input_schema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Optional substring to filter vendor names by (case-insensitive).',
        },
        limit: { type: 'integer', description: 'Max entries (default 30, max 100).' },
      },
    },
  },
  {
    name: 'getStatementGaps',
    description:
      'Find Issued leads with no advance recorded (the most common confusion). Use when they ask "why doesn\'t my Earned KPI match", "which deals didn\'t pay yet", "issued without advance". Returns the leads + total count + a one-line diagnosis.',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['ytd', 'mtd', 'last30', 'last90', 'all'],
          description: 'Date range to check (uses closedDate). Default "ytd".',
        },
      },
    },
  },
];

// ===== Period helpers =====

function periodToRange(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yyyy = today.getFullYear();
  const fmt = (d) => d.toISOString().slice(0, 10);
  switch (period) {
    case 'mtd':     return { from: fmt(new Date(yyyy, today.getMonth(), 1)), to: fmt(today) };
    case 'last30':  return { from: fmt(new Date(today.getTime() - 30  * 86400000)), to: fmt(today) };
    case 'last90':  return { from: fmt(new Date(today.getTime() - 90  * 86400000)), to: fmt(today) };
    case 'last365': return { from: fmt(new Date(today.getTime() - 365 * 86400000)), to: fmt(today) };
    case 'all':     return { from: null, to: null };
    case 'ytd':
    default:        return { from: `${yyyy}-01-01`, to: fmt(today) };
  }
}

function withinRange(iso, from, to) {
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

// Read a JSON blob from user_kv. Returns parsed value or null.
//
// `value` is a JSONB column — supabase-js returns it already parsed (object
// or array), NOT a string. We tolerate the legacy string shape just in case
// older rows were written as strings, but the common path is to use the
// returned value directly. Earlier versions ran JSON.parse on the parsed
// object and silently returned null — that broke every tool that reads kv.
async function readKv(supabase, userId, key) {
  const { data, error } = await supabase
    .from('user_kv')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (error || !data) return null;
  const v = data.value;
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

// ===== Tool handlers =====

const HANDLERS = {
  // ---------- searchLeads ----------
  async searchLeads({ supabase, userId, args }) {
    const limit = Math.min(Math.max(args.limit || 25, 1), 100);

    // Read from `leads` table — JSONB query
    const { data, error } = await supabase
      .from('leads')
      .select('data')
      .eq('user_id', userId);
    if (error) throw error;
    const all = (data || []).map(r => r.data).filter(Boolean);

    const filtered = all.filter(l => {
      if (args.stage && l.stage !== args.stage) return false;
      if (args.product && l.mainProduct !== args.product) return false;
      if (args.source && l.source !== args.source) return false;
      if (args.leadCategory && l.leadCategory !== args.leadCategory) return false;
      if (args.crm && l.crm !== args.crm) return false;
      if (args.campaign && l.campaign !== args.campaign) return false;
      if (args.ageBucket) {
        const a = Number(l.age) || 0;
        const b = l.ageBucket || null;
        const isOver50 = a > 50 || b === 'OVER_50';
        const isUnder50 = (a > 0 && a <= 50) || b === 'UNDER_50';
        if (args.ageBucket === 'OVER_50' && !isOver50) return false;
        if (args.ageBucket === 'UNDER_50' && !isUnder50) return false;
      }
      if (args.dateFrom || args.dateTo) {
        const date = l.closedDate || l.dateAdded;
        if (!date) return false;
        if (args.dateFrom && date < args.dateFrom) return false;
        if (args.dateTo   && date > args.dateTo)   return false;
      }
      return true;
    });

    // Sort newest first
    filtered.sort((a, b) => String(b.closedDate || b.dateAdded || '').localeCompare(String(a.closedDate || a.dateAdded || '')));

    const total = filtered.length;
    const sliced = filtered.slice(0, limit).map(l => ({
      name: l.name || '(no name)',
      stage: l.stage,
      product: l.mainProduct || null,
      source: l.source || null,
      age: l.age || null,
      ageBucket: l.ageBucket || null,
      advance: l.dealValue || 0,
      leadCost: l.leadCost || 0,
      closedDate: l.closedDate || null,
      crm: l.crm || null,
      campaign: l.campaign || null,
      leadCategory: l.leadCategory || null,
    }));

    return {
      total_matches: total,
      shown: sliced.length,
      leads: sliced,
    };
  },

  // ---------- getExpenseTotals ----------
  async getExpenseTotals({ supabase, userId, args }) {
    const period = args.period || 'ytd';
    let { from, to } = periodToRange(period);
    if (args.dateFrom) from = args.dateFrom;
    if (args.dateTo)   to   = args.dateTo;

    const expenses = (await readKv(supabase, userId, 'business_expenses_v1')) || [];
    const platforms = (await readKv(supabase, userId, 'platform_expenses_v1')) || [];

    const inWindow = (e) => withinRange(e.date, from, to);
    const filtered = expenses.filter(inWindow);
    const platformFiltered = platforms.filter(inWindow);

    const byCategory = {};
    let booksTotal = 0;
    for (const e of filtered) {
      const c = e.category || 'OTHER_EXPENSE';
      if (args.category && c !== args.category) continue;
      byCategory[c] = (byCategory[c] || 0) + Number(e.amount || 0);
      booksTotal += Number(e.amount || 0);
    }
    let platformTotal = 0;
    for (const p of platformFiltered) {
      platformTotal += Number(p.amount || 0);
    }

    return {
      period,
      window: { from, to },
      books_total: Math.round(booksTotal * 100) / 100,
      platforms_total: Math.round(platformTotal * 100) / 100,
      grand_total: Math.round((booksTotal + platformTotal) * 100) / 100,
      books_by_category: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
      note: args.category
        ? `Filtered to category "${args.category}" only.`
        : 'Books expenses + Platforms (Ringy/TD/VS) shown separately. Both feed True CPA.',
    };
  },

  // ---------- getImportHistory ----------
  async getImportHistory({ supabase, userId, args }) {
    const limit = Math.min(Math.max(args.limit || 10, 1), 25);
    const history = (await readKv(supabase, userId, 'import_history_v1')) || { entries: [] };
    let entries = history.entries || [];
    if (args.kind) {
      entries = entries.filter(e => (e.kind || '').includes(args.kind));
    }
    if (args.onlyErrors) {
      entries = entries.filter(e => !!e.error || (e.kind || '').endsWith('-error'));
    }
    entries = entries.slice(0, limit);

    return {
      total_entries: history.entries?.length || 0,
      shown: entries.length,
      entries: entries.map(e => ({
        kind: e.kind,
        filename: e.filename,
        run_at: e.runAt,
        duration_ms: e.durationMs,
        size_kb: e.size ? Math.round(e.size / 1024) : null,
        counts: e.counts,
        error: e.error || null,
        usage: e.usage ? {
          input_tokens: e.usage.inputTokens,
          output_tokens: e.usage.outputTokens,
          cached_read_tokens: e.usage.cachedReadTokens || 0,
        } : null,
      })),
    };
  },

  // ---------- getSubscriptionStatus ----------
  async getSubscriptionStatus({ supabase, userId }) {
    const { data, error } = await supabase
      .from('profiles')
      .select('email, subscription_status, subscription_tier, subscription_period, trial_ends_at, current_period_end, cancel_at_period_end, is_complimentary')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: 'Profile not found' };

    const trialDaysLeft = data.trial_ends_at
      ? Math.max(0, Math.ceil((new Date(data.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : null;

    return {
      email: data.email,
      tier: data.subscription_tier || null,
      period: data.subscription_period || null,
      status: data.subscription_status || (data.is_complimentary ? 'complimentary' : 'no_subscription'),
      is_complimentary: !!data.is_complimentary,
      trial_ends_at: data.trial_ends_at,
      trial_days_left: trialDaysLeft,
      current_period_end: data.current_period_end,
      cancel_at_period_end: data.cancel_at_period_end,
    };
  },

  // ---------- getVendorMemory ----------
  async getVendorMemory({ supabase, userId, args }) {
    const limit = Math.min(Math.max(args.limit || 30, 1), 100);
    const memory = (await readKv(supabase, userId, 'vendor_memory_v1')) || {};
    let entries = Object.entries(memory);
    if (args.search) {
      const q = String(args.search).toLowerCase();
      entries = entries.filter(([k]) => k.toLowerCase().includes(q));
    }
    entries.sort((a, b) => (b[1]?.hits || 0) - (a[1]?.hits || 0));
    entries = entries.slice(0, limit);

    return {
      total_entries: Object.keys(memory).length,
      shown: entries.length,
      mappings: entries.map(([vendor, info]) => ({
        vendor,
        direction: info?.direction || 'expense',
        category: info?.category || null,
        platformId: info?.platformId || null,
        hits: info?.hits || 1,
      })),
    };
  },

  // ---------- getStatementGaps ----------
  async getStatementGaps({ supabase, userId, args }) {
    const period = args.period || 'ytd';
    const { from, to } = periodToRange(period);

    const { data, error } = await supabase
      .from('leads')
      .select('data')
      .eq('user_id', userId);
    if (error) throw error;
    const all = (data || []).map(r => r.data).filter(Boolean);

    const issuedInRange = all.filter(l =>
      l.stage === 'Issued' &&
      withinRange(l.closedDate, from, to)
    );
    const gaps = issuedInRange.filter(l => !(Number(l.dealValue) > 0));

    return {
      period,
      window: { from, to },
      issued_in_range: issuedInRange.length,
      gaps_count: gaps.length,
      gaps: gaps.slice(0, 25).map(l => ({
        name: l.name || '(no name)',
        product: l.mainProduct || null,
        closed_date: l.closedDate,
        policy_number: l.policyNumber || null,
        state: l.state || null,
      })),
      diagnosis: gaps.length === 0
        ? 'No statement gaps in this period — every Issued lead has an advance recorded.'
        : `${gaps.length} of ${issuedInRange.length} Issued leads in ${period.toUpperCase()} have $0 advance. Most common cause: weekly Advance Statement PDFs not yet uploaded for those weeks. Direct the user to Upload → Weekly Advance Statement.`,
    };
  },
};

// ===== Public dispatcher =====

export async function runChatTool({ name, args, userId, supabase }) {
  const handler = HANDLERS[name];
  if (!handler) {
    return { error: `Unknown tool: ${name}` };
  }
  if (!userId) {
    return { error: 'Not signed in — tools that read user data require an authenticated session.' };
  }
  try {
    return await handler({ userId, supabase, args: args || {} });
  } catch (e) {
    console.error(`[chatTool ${name}] error:`, e);
    return { error: e.message || String(e) };
  }
}
