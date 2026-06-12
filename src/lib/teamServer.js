/**
 * teamServer.js — server-only helpers for the Team feature (/api/team/*).
 * NEVER import from client components (service-role key usage).
 *
 * Security model (spec §3.2):
 *  - Caller is authenticated via bearer → getUser.
 *  - Leader endpoints require the Team tier (or admin).
 *  - Cross-user reads require the target to be in the caller's ACTIVE
 *    downline subtree (teamTree.isDescendant — cycle-safe, depth-capped).
 *  - Every successful cross-user data read writes a team_access_log row.
 *  - No PHI in logs — actions/keys only.
 */

import { createClient } from '@supabase/supabase-js';
import { getDownlineIds, directReports } from './teamTree.mjs';

function cleanEnv(s) {
  return String(s || '').trim().replace(/^['"]|['"]$/g, '');
}

export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Service-role client + env validation. Returns { admin } or { error }. */
export function adminClient() {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) return { error: 'Server not configured' };
  return { admin: createClient(url, serviceKey, { auth: { persistSession: false } }) };
}

/** Bearer → authenticated caller { id, email } or null. */
export async function getCaller(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !anonKey) return null;
  const anon = createClient(url, anonKey);
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: String(data.user.email || '').toLowerCase() };
}

/**
 * Leader entitlement: Team tier (paid-active, trialing, or complimentary)
 * or platform admin. Agents responding to invites do NOT go through this.
 */
export async function isTeamLeaderEntitled(admin, userId) {
  const { data } = await admin
    .from('profiles')
    .select('subscription_tier, subscription_status, is_admin, is_complimentary')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return false;
  if (data.is_admin) return true;
  if (data.subscription_tier !== 'team') return false;
  return data.is_complimentary || ['active', 'trialing', 'past_due'].includes(data.subscription_status);
}

/**
 * All team edges (every status) — the working set for tree walks and invite
 * logic. Team graphs are small (tens of rows); fetching the table beats
 * per-level queries and keeps the pure teamTree helpers as the single
 * source of truth for traversal. Revisit if teams ever reach thousands.
 */
export async function fetchAllEdges(admin) {
  const { data, error } = await admin
    .from('team_members')
    .select('id, upline_id, downline_id, downline_email, status, invited_at, accepted_at');
  if (error) throw new Error(`team_members read failed: ${error.message}`);
  return (data || []).map(r => ({
    id: r.id,
    uplineId: r.upline_id,
    downlineId: r.downline_id,
    downlineEmail: r.downline_email,
    status: r.status,
    invitedAt: r.invited_at,
    acceptedAt: r.accepted_at,
  }));
}

/** Active descendant ids of a leader (cycle-safe). */
export function downlineIdsFrom(edges, leaderId, scope = 'all') {
  if (scope === 'direct') return directReports(leaderId, edges);
  return [...getDownlineIds(leaderId, edges)];
}

/** The per-member data keys the leader's views need (spec §3.3). */
export const TEAM_BUNDLE_KEYS = [
  'prospects_v1', 'prospect_settings_v1', 'leads_v5',
  'business_expenses_v1', 'business_income_v1', 'platform_expenses_v1',
  'overrides_v1', 'chargebacks_v1', 'own_advances_v1',
  'association_bonus_detail_v1', 'agent_tier_v1', 'agent_residual_rates_v1',
  'activities_v1',
];

// user_kv key → bundle field name the client expects.
const KEY_TO_FIELD = {
  prospects_v1: 'prospects',
  prospect_settings_v1: 'prospectSettings',
  leads_v5: 'leads',
  business_expenses_v1: 'businessExpenses',
  business_income_v1: 'businessIncome',
  platform_expenses_v1: 'platformExpenses',
  overrides_v1: 'overrides',
  chargebacks_v1: 'chargebacks',
  own_advances_v1: 'ownAdvances',
  association_bonus_detail_v1: 'abDetail',
  agent_tier_v1: 'agentTier',
  agent_residual_rates_v1: 'residualRates',
  activities_v1: 'activities',
};

/** One member's full data bundle + identity (service-role read). */
export async function fetchMemberBundle(admin, userId) {
  const [{ data: kvRows, error: kvErr }, { data: prof }] = await Promise.all([
    admin.from('user_kv').select('key, value').eq('user_id', userId).in('key', TEAM_BUNDLE_KEYS),
    admin.from('profiles').select('display_name, email').eq('id', userId).maybeSingle(),
  ]);
  if (kvErr) throw new Error(`user_kv read failed: ${kvErr.message}`);
  const bundle = {};
  for (const row of kvRows || []) {
    const field = KEY_TO_FIELD[row.key];
    if (field) bundle[field] = row.value;
  }
  return {
    userId,
    name: prof?.display_name || prof?.email || 'Agent',
    email: prof?.email || '',
    bundle,
  };
}

/** Audit a cross-user view. Never throws (audit failure must not break reads). */
export async function auditView(admin, leaderId, agentIds, action, detail = null) {
  try {
    const ids = Array.isArray(agentIds) ? agentIds : [agentIds];
    if (ids.length === 0) return;
    const rows = ids.map(agentId => ({ leader_id: leaderId, agent_id: agentId, action, detail }));
    const { error } = await admin.from('team_access_log').insert(rows);
    if (error) console.error(`[team/audit] insert failed: ${error.message}`);
  } catch (e) {
    console.error('[team/audit] error:', e?.message || String(e));
  }
}

/** Display names for a set of user ids (for rosters/breadcrumbs). */
export async function fetchNames(admin, userIds) {
  if (!userIds.length) return new Map();
  const { data } = await admin
    .from('profiles')
    .select('id, display_name, email')
    .in('id', userIds);
  const m = new Map();
  for (const p of data || []) m.set(p.id, { name: p.display_name || p.email || 'Agent', email: p.email || '' });
  return m;
}
