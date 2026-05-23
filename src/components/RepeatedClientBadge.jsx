'use client';
import { Repeat } from 'lucide-react';

/**
 * Small chip rendered next to a lead's name when it carries a
 * previousLeadId — i.e. the same client wrote a previous policy with
 * this agent that later lapsed/cancelled/dropped. Returns null for
 * non-repeat leads so callers can drop it in unconditionally.
 *
 *   <RepeatedClientBadge lead={lead} />
 */
export default function RepeatedClientBadge({ lead, className = '' }) {
  if (!lead?.previousLeadId) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wide dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700/60 ${className}`}
      title="This client previously wrote a policy that lapsed, cancelled, or dropped"
    >
      <Repeat size={10} /> Repeated
    </span>
  );
}
