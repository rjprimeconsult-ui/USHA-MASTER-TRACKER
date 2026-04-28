'use client';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Users, DollarSign, Database, ArrowLeft, ChevronDown, ChevronUp, AlertCircle, Loader2, RefreshCw, LogIn, Trash2, AlertTriangle, Wrench } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';
import { fmt, fmt2 } from '@/lib/utils';
import { OrbBackdrop } from '@/components/motion/MotionPrimitives';

/**
 * Read-only admin dashboard.
 *
 * Security:
 *   - Server-side: RLS policies (see admin-migration.sql) restrict admin
 *     SELECTs to users whose profile.is_admin = true.
 *   - Client-side: this page checks profile.is_admin before rendering data
 *     and shows a 403 otherwise.
 *
 * Cannot edit anything — pure observation. To change a user's data, use
 * the Supabase dashboard SQL editor with the queries in scripts/support-queries.sql.
 */
export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [check, setCheck] = useState({ loading: true, isAdmin: false });
  const [profiles, setProfiles] = useState([]);
  const [kvByUser, setKvByUser] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [expandedUser, setExpandedUser] = useState(null);
  const [error, setError] = useState('');
  const [impersonatingId, setImpersonatingId] = useState('');
  // Phantom-bonus tool state
  const [phantomScanning, setPhantomScanning] = useState(false);
  const [phantomList, setPhantomList] = useState(null); // null=not scanned, []=clean, [...]=found
  const [phantomDeleting, setPhantomDeleting] = useState(new Set());

  // Auth helper for the admin tools
  const adminFetch = async (url, opts = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No active admin session.');
    return fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(opts.headers || {}),
      },
    });
  };

  const scanPhantoms = async () => {
    setPhantomScanning(true); setError('');
    try {
      const res = await adminFetch('/api/admin/phantom-bonuses');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPhantomList(data.phantoms || []);
    } catch (e) {
      setError(`Phantom scan failed: ${e.message || e}`);
    } finally {
      setPhantomScanning(false);
    }
  };

  const deletePhantom = async (userId, entryId) => {
    const key = `${userId}|${entryId}`;
    setPhantomDeleting(prev => new Set([...prev, key]));
    setError('');
    try {
      const res = await adminFetch('/api/admin/phantom-bonuses', {
        method: 'POST',
        body: JSON.stringify({ userId, entryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPhantomList(prev => (prev || []).filter(p => !(p.userId === userId && p.entryId === entryId)));
    } catch (e) {
      setError(`Delete failed: ${e.message || e}`);
    } finally {
      setPhantomDeleting(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const deleteAllPhantoms = async () => {
    if (!phantomList?.length) return;
    if (!confirm(`Delete all ${phantomList.length} phantom entries? This can't be undone.`)) return;
    for (const p of phantomList) {
      await deletePhantom(p.userId, p.entryId);
    }
  };

  // Generate a magic-link sign-in for the target user, open in new tab.
  const impersonate = async (email, userId) => {
    if (!email) return;
    if (!confirm(`Sign in as ${email}?\n\nThis opens a new tab where you'll be signed in as them. Your admin session in this tab is unaffected.`)) return;
    setImpersonatingId(userId);
    setError('');
    try {
      const res = await adminFetch('/api/admin/impersonate', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!data.url) throw new Error('No magic-link URL returned');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(`Impersonation failed: ${e.message || e}`);
    } finally {
      setImpersonatingId('');
    }
  };

  // Verify admin status once we know who the current user is
  useEffect(() => {
    if (authLoading) return;
    if (!user) { setCheck({ loading: false, isAdmin: false }); return; }
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (e) console.warn(e);
        setCheck({ loading: false, isAdmin: data?.is_admin === true });
      });
  }, [authLoading, user]);

  const fetchAll = async () => {
    setRefreshing(true);
    setError('');
    try {
      const [profilesRes, kvRes] = await Promise.all([
        supabase.from('profiles').select('id, email, display_name, tier, is_admin, created_at, updated_at').order('created_at', { ascending: false }),
        supabase.from('user_kv').select('user_id, key, value, updated_at'),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (kvRes.error)       throw kvRes.error;
      setProfiles(profilesRes.data || []);
      const grouped = {};
      (kvRes.data || []).forEach(row => {
        if (!grouped[row.user_id]) grouped[row.user_id] = {};
        grouped[row.user_id][row.key] = { value: row.value, updated_at: row.updated_at };
      });
      setKvByUser(grouped);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { if (check.isAdmin) fetchAll(); }, [check.isAdmin]);

  // ---------- Stats ----------
  const stats = useMemo(() => {
    const totalUsers = profiles.length;
    const verifiedAdmins = profiles.filter(p => p.is_admin).length;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const activeUsers = Object.values(kvByUser).filter(kv =>
      Object.values(kv).some(({ updated_at }) => new Date(updated_at) > sevenDaysAgo)
    ).length;
    let totalLeads = 0, totalEarned = 0, totalExpenses = 0, totalIncome = 0;
    for (const kv of Object.values(kvByUser)) {
      const leads = kv['leads_v5']?.value;
      if (Array.isArray(leads)) {
        totalLeads += leads.length;
        for (const l of leads) {
          if (l.stage === 'Issued') totalEarned += Number(l.dealValue || 0);
        }
      }
      const exp = kv['business_expenses_v1']?.value;
      if (Array.isArray(exp)) totalExpenses += exp.reduce((s, e) => s + Number(e.amount || 0), 0);
      const inc = kv['business_income_v1']?.value;
      if (Array.isArray(inc)) totalIncome += inc.reduce((s, e) => s + Number(e.amount || 0), 0);
    }
    return { totalUsers, verifiedAdmins, activeUsers, totalLeads, totalEarned, totalExpenses, totalIncome };
  }, [profiles, kvByUser]);

  // ---------- Render gates ----------
  if (authLoading || check.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!user) {
    return <FullPage>Sign in required to access /admin.</FullPage>;
  }

  if (!check.isAdmin) {
    return (
      <FullPage>
        <div className="text-center max-w-md">
          <Shield size={32} className="mx-auto text-red-500 mb-3" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">403 — Admin only</h1>
          <p className="text-sm text-slate-500 mb-4">
            This page is restricted to PRIM administrators. You're signed in as <b>{user.email}</b>.
          </p>
          <Link href="/" className="text-indigo-600 hover:text-indigo-700 text-sm font-semibold">
            ← Back to your tracker
          </Link>
        </div>
      </FullPage>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 relative">
      <OrbBackdrop />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-mesh-luxe opacity-90" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/30">
              <Shield size={18} />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 leading-none tracking-tight">PRIM Admin</h1>
              <div className="text-xs text-slate-500">Read-only · {user.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAll}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition text-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <Link
              href="/"
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition text-sm"
            >
              <ArrowLeft size={14} /> Back to tracker
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5 space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Users" value={stats.totalUsers} Icon={Users} grad="from-indigo-500 to-blue-500" />
          <StatCard label="Active (7d)" value={stats.activeUsers} Icon={Users} grad="from-emerald-500 to-green-500" sub="logged something this week" />
          <StatCard label="Admins" value={stats.verifiedAdmins} Icon={Shield} grad="from-rose-500 to-orange-500" />
          <StatCard label="Total Leads" value={stats.totalLeads} Icon={Database} grad="from-violet-500 to-purple-500" />
          <StatCard label="Total Earned" value={fmt(stats.totalEarned)} Icon={DollarSign} grad="from-amber-500 to-orange-500" sub="all users · all time" />
          <StatCard label="Net Books" value={fmt(stats.totalIncome - stats.totalExpenses)} Icon={DollarSign} grad="from-cyan-500 to-teal-500" sub={`${fmt(stats.totalIncome)} − ${fmt(stats.totalExpenses)}`} />
        </div>

        {/* User table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">All users</h2>
            <span className="text-xs text-slate-500">Click a row to expand collection details</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="text-left p-3">Email</th>
                  <th className="text-left p-3">Joined</th>
                  <th className="text-left p-3">Tier</th>
                  <th className="text-left p-3">Admin</th>
                  <th className="text-right p-3">Leads</th>
                  <th className="text-right p-3">Issued</th>
                  <th className="text-right p-3">Earned</th>
                  <th className="text-right p-3">Books In</th>
                  <th className="text-right p-3">Books Out</th>
                  <th className="text-left p-3">Last activity</th>
                  <th className="text-right p-3">Sign in</th>
                </tr>
              </thead>
              <tbody>
                {profiles.length === 0 && (
                  <tr><td colSpan={11} className="text-center p-8 text-slate-400">No users yet</td></tr>
                )}
                {profiles.map(p => {
                  const kv = kvByUser[p.id] || {};
                  const leads = Array.isArray(kv['leads_v5']?.value) ? kv['leads_v5'].value : [];
                  const issued = leads.filter(l => l.stage === 'Issued');
                  const earned = issued.reduce((s, l) => s + Number(l.dealValue || 0), 0);
                  const exp = Array.isArray(kv['business_expenses_v1']?.value) ? kv['business_expenses_v1'].value : [];
                  const inc = Array.isArray(kv['business_income_v1']?.value) ? kv['business_income_v1'].value : [];
                  const expTotal = exp.reduce((s, e) => s + Number(e.amount || 0), 0);
                  const incTotal = inc.reduce((s, e) => s + Number(e.amount || 0), 0);
                  const lastActivity = Object.values(kv).reduce((max, x) =>
                    (!max || new Date(x.updated_at) > new Date(max)) ? x.updated_at : max, null);
                  const isExpanded = expandedUser === p.id;

                  return (
                    <>
                      <tr
                        key={p.id}
                        className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${isExpanded ? 'bg-indigo-50/40' : ''}`}
                        onClick={() => setExpandedUser(isExpanded ? null : p.id)}
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                            <span className="font-medium text-slate-900 truncate">{p.email || '(no email)'}</span>
                          </div>
                        </td>
                        <td className="p-3 text-slate-600 text-xs whitespace-nowrap">{shortDate(p.created_at)}</td>
                        <td className="p-3 text-slate-600">{p.tier || 'WA'}</td>
                        <td className="p-3">
                          {p.is_admin && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">ADMIN</span>}
                        </td>
                        <td className="text-right p-3">{leads.length}</td>
                        <td className="text-right p-3 text-emerald-700">{issued.length}</td>
                        <td className="text-right p-3 text-emerald-700 font-semibold whitespace-nowrap">{fmt(earned)}</td>
                        <td className="text-right p-3 text-emerald-600 whitespace-nowrap">{fmt(incTotal)}</td>
                        <td className="text-right p-3 text-red-600 whitespace-nowrap">{fmt(expTotal)}</td>
                        <td className="p-3 text-xs text-slate-500 whitespace-nowrap">{lastActivity ? relativeTime(lastActivity) : '—'}</td>
                        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => impersonate(p.email, p.id)}
                            disabled={impersonatingId === p.id || p.id === user.id}
                            title={p.id === user.id ? "You're already signed in as this user" : `Sign in as ${p.email}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 disabled:text-slate-300 disabled:hover:bg-transparent px-2 py-1 rounded"
                          >
                            {impersonatingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                            Sign in
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={11} className="p-4">
                            <CollectionDetails kv={kv} userId={p.id} userEmail={p.email} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Maintenance tools */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench size={16} className="text-amber-600" />
              <h2 className="font-semibold text-slate-900">Maintenance — phantom bonus entries</h2>
            </div>
            <button
              onClick={scanPhantoms}
              disabled={phantomScanning}
              className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              {phantomScanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {phantomScanning ? 'Scanning...' : phantomList === null ? 'Scan all users' : 'Re-scan'}
            </button>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-slate-500 mb-3">
              Finds Books-income entries that look like phantom bonuses created by the old (pre-fix) statement parser — Account Summary table headers that bridged into unrelated rows. Each user&apos;s data is checked individually; safe to run anytime.
            </p>
            {phantomList === null && (
              <div className="text-sm text-slate-400 italic">Click &quot;Scan all users&quot; to start.</div>
            )}
            {phantomList?.length === 0 && (
              <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                <Shield size={14} /> All clean — no phantom entries detected across any user.
              </div>
            )}
            {phantomList?.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 flex items-center gap-2">
                    <AlertTriangle size={14} /> {phantomList.length} phantom {phantomList.length === 1 ? 'entry' : 'entries'} found
                  </div>
                  <button
                    onClick={deleteAllPhantoms}
                    className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                  >
                    <Trash2 size={12} /> Delete all {phantomList.length}
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="text-left p-2">User</th>
                        <th className="text-left p-2">Date</th>
                        <th className="text-right p-2">Amount</th>
                        <th className="text-left p-2">Phantom label</th>
                        <th className="text-right p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {phantomList.map(p => {
                        const key = `${p.userId}|${p.entryId}`;
                        const deleting = phantomDeleting.has(key);
                        return (
                          <tr key={key} className="border-t border-slate-100">
                            <td className="p-2 font-medium text-slate-900">{p.email}</td>
                            <td className="p-2 text-slate-600 whitespace-nowrap">{p.date || '—'}</td>
                            <td className="p-2 text-right text-emerald-700 font-semibold whitespace-nowrap">{fmt2(p.amount)}</td>
                            <td className="p-2 text-slate-600 max-w-md truncate" title={p.source}>{p.source}</td>
                            <td className="p-2 text-right">
                              <button
                                onClick={() => deletePhantom(p.userId, p.entryId)}
                                disabled={deleting}
                                className="text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 ml-auto"
                              >
                                {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="text-xs text-slate-500 text-center pb-4">
          🔒 Read-only view (except the maintenance tools above). To modify any user&apos;s data ad-hoc, use the Supabase SQL Editor with the queries in <code className="bg-slate-200 px-1 rounded">scripts/support-queries.sql</code>.
        </div>
      </main>
    </div>
  );
}

function FullPage({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative">
      <OrbBackdrop />
      <div className="bg-white/85 backdrop-blur-2xl border border-white/60 rounded-2xl shadow-2xl shadow-indigo-500/10 p-8 max-w-md w-full">
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, value, Icon, grad, sub }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl p-3 border border-slate-200"
    >
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center text-white mb-2 shadow-md`}>
        <Icon size={16} />
      </div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </motion.div>
  );
}

function CollectionDetails({ kv, userId, userEmail }) {
  const [openKey, setOpenKey] = useState(null);
  const keys = Object.keys(kv).sort();
  if (keys.length === 0) {
    return <div className="text-sm text-slate-500 italic">This user has no collections yet.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-600 mb-2">
        <span className="font-semibold">user_id:</span> <code className="bg-white px-1 rounded text-[10px]">{userId}</code>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left p-2">Collection</th>
              <th className="text-right p-2">Item count / Value</th>
              <th className="text-left p-2">Updated</th>
              <th className="p-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map(key => {
              const { value, updated_at } = kv[key];
              const isArr = Array.isArray(value);
              const summary = isArr
                ? `${value.length} items`
                : (typeof value === 'object' ? 'object' : String(value));
              const isOpen = openKey === key;
              return (
                <>
                  <tr key={key} className="border-t border-slate-100">
                    <td className="p-2 font-mono">{key}</td>
                    <td className="text-right p-2 font-semibold">{summary}</td>
                    <td className="p-2 text-slate-500">{shortDate(updated_at)}</td>
                    <td className="text-right p-2">
                      <button
                        onClick={() => setOpenKey(isOpen ? null : key)}
                        className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                      >
                        {isOpen ? 'Hide JSON' : 'Show JSON'}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50">
                      <td colSpan={4} className="p-2">
                        <pre className="bg-white border border-slate-200 rounded p-2 text-[10px] font-mono max-h-96 overflow-auto whitespace-pre-wrap">
                          {JSON.stringify(value, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function shortDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}
function relativeTime(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d} day${d !== 1 ? 's' : ''} ago`;
  const mo = Math.floor(d / 30);
  return `${mo} mo ago`;
}
