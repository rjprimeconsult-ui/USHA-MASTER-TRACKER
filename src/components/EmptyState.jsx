'use client';
import { ArrowRight, Sparkles } from 'lucide-react';

/**
 * Standardized empty-state card for views with no data yet.
 *
 * Drops into any place where you currently render "no rows yet" text.
 * Three sections: icon + headline + supporting copy + 1-2 action buttons.
 * Hidden by default in compact mode for small/inline contexts (e.g.
 * "no overdue follow-ups" inline).
 *
 * Props:
 *   icon       — lucide-react Icon component (e.g. Inbox, Sparkles)
 *   title      — short headline (max ~6 words)
 *   message    — one or two sentences explaining what this view does +
 *                what populating it unlocks. Keep under ~30 words.
 *   actions    — [{ label, onClick?, href?, primary?, icon? }, ...]
 *                Up to 2 buttons. First is rendered as primary (indigo);
 *                second as secondary (outlined).
 *   compact    — when true, smaller padding + smaller icon. For inline
 *                use inside cards/columns where a full empty state is
 *                too much.
 *   className  — extra classes (e.g. container background)
 */
export default function EmptyState({
  icon: Icon = Sparkles,
  title,
  message,
  actions = [],
  compact = false,
  className = '',
}) {
  const padding = compact ? 'py-5 px-3' : 'py-10 px-4';
  const iconSize = compact ? 18 : 28;
  const iconBox = compact ? 'w-9 h-9' : 'w-14 h-14';
  const titleClass = compact ? 'text-sm' : 'text-base';

  return (
    <div className={`flex flex-col items-center text-center ${padding} ${className}`}>
      <div className={`${iconBox} rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center mb-3`}>
        <Icon size={iconSize} className="text-indigo-600" />
      </div>
      {title && (
        <h3 className={`font-semibold text-slate-800 ${titleClass} mb-1`}>{title}</h3>
      )}
      {message && (
        <p className="text-xs text-slate-500 max-w-md leading-relaxed mb-4">{message}</p>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {actions.slice(0, 2).map((a, i) => {
            const primary = a.primary !== false && i === 0;
            const Tag = a.href ? 'a' : 'button';
            const props = a.href
              ? { href: a.href }
              : { type: 'button', onClick: a.onClick };
            const cls = primary
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition'
              : 'bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition';
            return (
              <Tag key={i} {...props} className={cls}>
                {a.icon ? <a.icon size={14} /> : null}
                {a.label}
                {primary && <ArrowRight size={12} />}
              </Tag>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Variant that fits inside an existing table — colspans the entire row.
 * Use when your view is a <table> and you don't want to break it apart.
 */
export function EmptyStateTableRow({ colSpan = 8, ...rest }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <EmptyState {...rest} />
      </td>
    </tr>
  );
}
