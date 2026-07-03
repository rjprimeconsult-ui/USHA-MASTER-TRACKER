'use client';
// Dependency-free styled tooltip. Shows on hover AND keyboard focus.
// Usage: <Tooltip label="Edit"><button aria-label="Edit">…</button></Tooltip>
export default function Tooltip({ label, side = 'top', className = '', children }) {
  if (!label) return children;
  return (
    <span className={`prim-tip prim-tip-${side} ${className}`} data-tip={label}>
      {children}
    </span>
  );
}
