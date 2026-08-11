/** SERVER-ONLY — imports the service-role client; never import from client code. */
import { getSupabaseAdmin } from './stripe-server';
import { gateFromProfile, GATE_FIELDS } from './subscriptionAccess.mjs';

export async function requireFullAccess(userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(GATE_FIELDS.join(', '))   // pinned by the Task-1 GATE_FIELDS test
      .eq('id', userId)
      .maybeSingle();
    return gateFromProfile(profile, error || (!profile ? new Error('no profile') : null));
  } catch (e) {
    // getSupabaseAdmin throws on missing env (stripe-server.js:30-39). Spec §7
    // promises fail-CLOSED-as-402, not a 500 — especially since import-expenses-ai's
    // insert sits above its own JSON-error net. Round-3 note 6.
    return { ok: false, level: 'locked', transient: true };
  }
}
