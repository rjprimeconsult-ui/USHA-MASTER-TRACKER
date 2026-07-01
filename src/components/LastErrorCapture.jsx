'use client';
import { useEffect } from 'react';

/**
 * Stores a SHORT, PHI-free last-error string on window.__lastError so the
 * Report-an-issue form can attach it as diagnostic context. Captures the error
 * MESSAGE + SOURCE only — never app state, form values, or user data — and caps
 * length so nothing large or sensitive can ride along.
 */
export default function LastErrorCapture() {
  useEffect(() => {
    const cap = (s) => { try { window.__lastError = String(s || '').slice(0, 300); } catch { /* ignore */ } };
    const onError = (e) => cap(`${e?.message || 'error'} @ ${e?.filename || ''}:${e?.lineno || ''}`);
    const onRej = (e) => cap(`unhandledrejection: ${e?.reason?.message || e?.reason || 'rejection'}`);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);
  return null;
}
