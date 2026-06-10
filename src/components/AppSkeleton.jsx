'use client';

/**
 * Premium boot skeleton — shown while user data loads at startup.
 * Mirrors the app shell (header, nav pills, KPI row, chart cards) so the
 * first paint feels like PRIM assembling itself rather than a blank
 * "Loading…" flash. Pure presentation: no data, no logic, no handlers.
 * Dark mode works automatically via the global .dark utility overrides
 * (bg-white → card navy, etc.) and the .dark .skeleton tone.
 */
export default function AppSkeleton() {
  return (
    <div className="min-h-screen bg-prim-canvas">
      {/* Header bar */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="skeleton w-9 h-9 rounded-xl" />
            <div className="skeleton h-4 w-28 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton h-8 w-24 rounded-lg" />
          </div>
        </div>
        {/* Nav pills */}
        <div className="max-w-screen-2xl mx-auto px-4 pb-3 flex gap-2 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-8 rounded-lg flex-shrink-0" style={{ width: 72 + ((i * 29) % 40) }} />
          ))}
        </div>
      </div>

      <main className="max-w-screen-2xl mx-auto px-4 py-5 space-y-5">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="skeleton w-8 h-8 rounded-lg" />
              <div className="skeleton h-3 w-16 rounded" />
              <div className="skeleton h-6 w-20 rounded-md" />
            </div>
          ))}
        </div>

        {/* Chart cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="skeleton h-4 w-40 rounded-md" />
            <div className="skeleton h-56 w-full rounded-lg" />
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="skeleton h-4 w-24 rounded-md" />
            <div className="skeleton h-56 w-full rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="skeleton h-4 w-36 rounded-md" />
              <div className="skeleton h-44 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
