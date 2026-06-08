'use client';
/**
 * Route-level error boundary. Catches render/runtime errors in the app
 * (the main LeadTracker tree) and shows a friendly fallback instead of a
 * blank white screen. The user's data is safe in storage — this is a
 * display-layer recovery. `reset()` re-renders the segment.
 */
import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => {
    // Visible in Vercel function/client logs for diagnosis.
    console.error('[PRIM] render error:', error);
  }, [error]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#070B17', color: '#F1F5F9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Something went wrong</h1>
        <p style={{ color: '#94A3B8', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
          Your data is safe — it&apos;s saved. This is just a display hiccup, and reloading usually fixes it.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => reset()} style={{ background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Reload
          </button>
          <a href="/" style={{ color: '#F1F5F9', border: '1px solid #3A476B', borderRadius: 10, padding: '10px 18px', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>
            Go home
          </a>
        </div>
        {error?.digest && <p style={{ color: '#475569', fontSize: 11, marginTop: 16 }}>Ref: {error.digest}</p>}
      </div>
    </div>
  );
}
