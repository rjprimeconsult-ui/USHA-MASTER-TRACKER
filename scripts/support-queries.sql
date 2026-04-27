-- =====================================================================
-- PRIM support-query cookbook
-- Paste any of these into Supabase SQL Editor when investigating an issue.
-- Replace 'agent@example.com' with the real user's email.
-- =====================================================================


-- ----------------------------------------------------------------------
-- USERS
-- ----------------------------------------------------------------------

-- 1. List every user (newest first)
SELECT
  u.email,
  u.created_at AS signed_up,
  u.last_sign_in_at AS last_login,
  u.email_confirmed_at IS NOT NULL AS verified,
  p.is_admin,
  p.tier
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
ORDER BY u.created_at DESC;


-- 2. Find one user by email (gets you their user_id for further queries)
SELECT id, email, created_at, last_sign_in_at, email_confirmed_at
FROM auth.users
WHERE email = 'agent@example.com';


-- 3. Recent sign-ups (last 30 days) + their item counts
SELECT
  u.email,
  u.created_at::date AS signed_up,
  COUNT(DISTINCT k.key) AS collections_filled,
  MAX(k.updated_at) AS last_activity
FROM auth.users u
LEFT JOIN user_kv k ON k.user_id = u.id
WHERE u.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.email, u.created_at
ORDER BY u.created_at DESC;


-- 4. Users who signed up but haven't logged anything
SELECT u.email, u.created_at, u.last_sign_in_at
FROM auth.users u
LEFT JOIN user_kv k ON k.user_id = u.id
WHERE k.user_id IS NULL
ORDER BY u.created_at DESC;


-- ----------------------------------------------------------------------
-- DATA INSPECTION
-- ----------------------------------------------------------------------

-- 5. Snapshot of one user's collections (counts + last update)
SELECT
  k.key,
  CASE
    WHEN jsonb_typeof(k.value) = 'array' THEN jsonb_array_length(k.value)::text || ' items'
    WHEN jsonb_typeof(k.value) = 'object' THEN 'object'
    ELSE k.value::text
  END AS value_summary,
  k.updated_at
FROM user_kv k
JOIN auth.users u ON u.id = k.user_id
WHERE u.email = 'agent@example.com'
ORDER BY k.updated_at DESC;


-- 6. Pull one user's entire leads array (use jsonb pretty for readability)
SELECT jsonb_pretty(k.value) AS leads_json
FROM user_kv k
JOIN auth.users u ON u.id = k.user_id
WHERE u.email = 'agent@example.com' AND k.key = 'leads_v5';


-- 7. Find a specific lead by name across all users (case-insensitive)
SELECT
  u.email,
  lead->>'name' AS lead_name,
  lead->>'stage' AS stage,
  lead->>'dealValue' AS deal_value
FROM user_kv k
JOIN auth.users u ON u.id = k.user_id
CROSS JOIN LATERAL jsonb_array_elements(k.value) AS lead
WHERE k.key = 'leads_v5'
  AND lower(lead->>'name') LIKE lower('%john smith%');


-- 8. Total $ flowing through the system (everyone's earned commissions)
SELECT
  u.email,
  COALESCE(SUM((lead->>'dealValue')::numeric), 0) AS total_earned
FROM user_kv k
JOIN auth.users u ON u.id = k.user_id
CROSS JOIN LATERAL jsonb_array_elements(k.value) AS lead
WHERE k.key = 'leads_v5' AND lead->>'stage' = 'Issued'
GROUP BY u.email
ORDER BY total_earned DESC;


-- ----------------------------------------------------------------------
-- SUPPORT ACTIONS (use carefully — these write data)
-- ----------------------------------------------------------------------

-- 9. Re-confirm a user's email (skip the confirmation link)
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email = 'agent@example.com' AND email_confirmed_at IS NULL;


-- 10. Reset all of one user's collections (nuclear option — start fresh)
DELETE FROM user_kv
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'agent@example.com');


-- 11. Promote a user to admin (gives them /admin page access)
UPDATE profiles
SET is_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'agent@example.com');


-- 12. Demote a user from admin
UPDATE profiles
SET is_admin = false
WHERE id = (SELECT id FROM auth.users WHERE email = 'agent@example.com');


-- 13. Delete a user entirely (cascades to user_kv via FK)
-- DOES NOT REMOVE storage receipts — clean those up via the Storage UI.
DELETE FROM auth.users WHERE email = 'agent@example.com';


-- ----------------------------------------------------------------------
-- HEALTH METRICS
-- ----------------------------------------------------------------------

-- 14. Active users in the last 7 days (logged something)
SELECT COUNT(DISTINCT user_id) AS weekly_active
FROM user_kv
WHERE updated_at > NOW() - INTERVAL '7 days';


-- 15. Total storage usage by user (approx, JSON byte count)
SELECT
  u.email,
  pg_size_pretty(SUM(octet_length(k.value::text))::bigint) AS data_size
FROM user_kv k
JOIN auth.users u ON u.id = k.user_id
GROUP BY u.email
ORDER BY SUM(octet_length(k.value::text)) DESC;


-- 16. Receipts bucket usage by user
SELECT
  u.email,
  COUNT(o.id) AS receipt_count,
  pg_size_pretty(SUM(o.metadata->>'size')::bigint) AS total_size
FROM storage.objects o
JOIN auth.users u ON u.id::text = (storage.foldername(o.name))[1]
WHERE o.bucket_id = 'receipts'
GROUP BY u.email
ORDER BY COUNT(o.id) DESC;
