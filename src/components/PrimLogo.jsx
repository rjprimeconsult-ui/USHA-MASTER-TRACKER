'use client';

/**
 * PRIM brand assets.
 *
 *   <PrimMark />        — the prism mark only. Designed to live INSIDE a
 *                         gradient/colored wrapper (header pill, sign-in tile).
 *                         Uses currentColor so it inherits text-white from
 *                         the parent.
 *
 *   <PrimAppIcon />     — fully self-contained dark-tile app icon (the
 *                         "dark frame, glowing prism" variant). Used for
 *                         the favicon and any standalone brand surface.
 */

// The prism mark only. White / currentColor so it inherits parent text color.
export function PrimMark({ size = 18, className = '', title = 'PRIM' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={title}
      className={className}
    >
      {/* prism (triangle) */}
      <path
        d="M5 19 L12 4 L19 19 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      {/* inner facet — slight depth */}
      <line x1="12" y1="4" x2="12" y2="19" stroke="#0F172A" strokeWidth="0.6" opacity="0.18" />
      {/* refracted beams (faint stubs so they read at small sizes) */}
      <line x1="19" y1="13" x2="22.5" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.95" />
      <line x1="19.4" y1="14" x2="22.5" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      <line x1="19" y1="15" x2="22.5" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

// Full self-contained app icon. Dark tile + gradient prism + colored beams.
export function PrimAppIcon({ size = 64, className = '', title = 'PRIM' }) {
  // Unique gradient IDs so multiple icons can coexist on a page
  const uid = `prim-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 180 180"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient id={`${uid}-frame`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0F172A" />
          <stop offset="100%" stopColor="#1E1B4B" />
        </linearGradient>
        <linearGradient id={`${uid}-prismLeft`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4338CA" />
          <stop offset="100%" stopColor="#3730A3" />
        </linearGradient>
        <linearGradient id={`${uid}-prismRight`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* tile */}
      <rect x="6" y="6" width="168" height="168" rx="38" fill={`url(#${uid}-frame)`} stroke="#312E81" strokeWidth="1.5" />
      {/* prism back face */}
      <polygon points="48,142 90,42 90,142" fill={`url(#${uid}-prismLeft)`} />
      {/* prism front face */}
      <polygon points="90,42 132,142 90,142" fill={`url(#${uid}-prismRight)`} />
      {/* shine overlay */}
      <polygon points="48,142 90,42 132,142" fill={`url(#${uid}-shine)`} />
      {/* prism outline */}
      <polygon
        points="48,142 90,42 132,142"
        fill="none"
        stroke="#C4B5FD"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* refracted beams */}
      <line x1="118" y1="100" x2="160" y2="80"  stroke="#22D3EE" strokeWidth="4" strokeLinecap="round" opacity="0.95" />
      <line x1="118" y1="106" x2="160" y2="106" stroke="#A78BFA" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
      <line x1="118" y1="112" x2="160" y2="132" stroke="#F472B6" strokeWidth="4" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

// Default export = the mark, since that's the most common use.
export default PrimMark;
