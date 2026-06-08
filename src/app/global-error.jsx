'use client';
/**
 * Root-level error boundary — last-resort catch for errors thrown in the
 * root layout (auth/theme providers). Must render its own <html>/<body>.
 */
import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => { console.error('[PRIM] root error:', error); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#070B17', color: '#F1F5F9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ maxWidth: 460, textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ color: '#94A3B8', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>Your data is safe. Try reloading.</p>
          <button onClick={() => reset()} style={{ background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
