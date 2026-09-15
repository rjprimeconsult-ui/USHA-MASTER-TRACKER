// Routine Builder — key literals. NO imports (this file is loaded by the tick
// route, the client store, and node --test alike).
//
// PROSPECTS_KEY / PROSPECT_SETTINGS_KEY are duplicated from the module-private
// consts of the same name in src/components/LeadTracker.jsx on purpose: the
// routine READS those keys and never writes them (spec §4e).
//
// PUSH_SUBS_KEY is likewise duplicated from the route-local consts in
// src/app/api/push/subscribe/route.js, src/app/api/push/test/route.js, and
// src/app/api/reminders/route.js.
export const ROUTINE_BLOCKS_KEY = 'routine_blocks_v1';
export const ROUTINE_DAY_KEY = 'routine_day_v1';
export const ROUTINE_SETTINGS_KEY = 'routine_settings_v1';
export const PUSH_SUBS_KEY = 'push_subscriptions_v1';
export const PROSPECTS_KEY = 'prospects_v1';
export const PROSPECT_SETTINGS_KEY = 'prospect_settings_v1';
export const ROUTINE_FEATURE_KEY = 'routine_builder';
export const ROUTINE_KEYS = [ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY];
