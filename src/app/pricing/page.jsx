'use client';
import { useState } from 'react';
import { Check, Sparkles, Zap, Users } from 'lucide-react';
import { STRIPE_PRICES, PLAN_DISPLAY, TRIAL_DAYS } from '@/lib/stripe-prices';
import { startCheckout } from '@/lib/subscription';

const TIER_ICONS = {
  starter: Sparkles,
  pro: Zap,
  team: Users,
};

const TIER_GRADIENTS = {
  starter: 'from-emerald-500 to-teal-600',
  pro: 'from-indigo-500 to-violet-600',
  team: 'from-fuchsia-500 to-rose-600',
};

// How much yearly saves vs paying monthly × 12, per plan.
const savingsPct = (plan) =>
  Math.round((1 - plan.yearly / (plan.monthly * 12)) * 100);
const MAX_SAVINGS = Math.max(...Object.values(PLAN_DISPLAY).map(savingsPct));

export default function PricingPage() {
  const [period, setPeriod] = useState('monthly'); // 'monthly' | 'yearly'
  const [busy, setBusy] = useState('');

  const handleSubscribe = async (tierId) => {
    setBusy(tierId);
    try {
      const priceId = STRIPE_PRICES[tierId][period];
      await startCheckout(priceId);
    } catch (e) {
      alert(`Couldn't start checkout: ${e.message || e}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-block bg-indigo-100 text-indigo-700 text-xs font-bold uppercase tracking-wider rounded-full px-3 py-1 mb-4">
            {TRIAL_DAYS}-day free trial · cancel anytime
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-3">
            Pick a plan that fits your book
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Every plan includes Smart Import (AI), vendor memory, and the PRIM
            Assistant. Pro and Team unlock the dashboards and tools agents use
            once their book is paying real money.
          </p>
        </div>

        {/* Period toggle */}
        <div className="flex justify-center mb-10">
          <div className="bg-white border border-slate-200 rounded-full p-1 shadow-sm flex">
            <button
              onClick={() => setPeriod('monthly')}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition ${
                period === 'monthly'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setPeriod('yearly')}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition ${
                period === 'yearly'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Yearly
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5">
                Save up to {MAX_SAVINGS}%
              </span>
            </button>
          </div>
        </div>

        {/* Plan grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Object.entries(PLAN_DISPLAY).map(([tierId, plan]) => {
            const Icon = TIER_ICONS[tierId];
            const gradient = TIER_GRADIENTS[tierId];
            const price = period === 'monthly' ? plan.monthly : plan.yearly;
            const monthlyEquiv = period === 'yearly' ? (plan.yearly / 12) : null;
            const isBusy = busy === tierId;

            return (
              <div
                key={tierId}
                className={`relative bg-white border rounded-2xl p-6 flex flex-col ${
                  plan.popular
                    ? 'border-indigo-500 shadow-xl shadow-indigo-500/20 ring-2 ring-indigo-200'
                    : 'border-slate-200 shadow-sm'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold uppercase tracking-wider rounded-full px-3 py-1">
                    Most popular
                  </div>
                )}

                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} text-white flex items-center justify-center shadow-lg`}>
                    <Icon size={20} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{plan.name}</h2>
                </div>

                <p className="text-sm text-slate-600 mb-5 min-h-[40px]">{plan.tagline}</p>

                <div className="mb-5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-bold text-slate-900">
                      ${period === 'yearly' ? Math.round(price) : price.toFixed(2)}
                    </span>
                    <span className="text-sm text-slate-500">
                      / {period === 'monthly' ? 'month' : 'year'}
                    </span>
                  </div>
                  {monthlyEquiv && (
                    <div className="text-xs text-slate-500 mt-1">
                      ${monthlyEquiv.toFixed(2)}/month billed annually
                    </div>
                  )}
                  {/* Always surface the yearly option from the monthly view so
                      agents can't miss the discount — one tap switches it. */}
                  {period === 'monthly' && (
                    <button
                      onClick={() => setPeriod('yearly')}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full px-2.5 py-1 transition"
                    >
                      💡 Pay yearly &amp; save {savingsPct(plan)}% (${Math.round(plan.yearly)}/yr)
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleSubscribe(tierId)}
                  disabled={isBusy}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm transition mb-6 ${
                    plan.popular
                      ? 'bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-lg shadow-indigo-500/30'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  } disabled:opacity-50`}
                >
                  {isBusy ? 'Redirecting…' : `Start ${TRIAL_DAYS}-day free trial`}
                </button>

                <ul className="space-y-2 text-sm text-slate-700">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Footer copy */}
        <div className="text-center mt-12 text-sm text-slate-500 max-w-2xl mx-auto">
          <p className="mb-2">
            Card required to start the trial. You won&apos;t be charged for {TRIAL_DAYS} days
            and can cancel any time from Settings → Manage subscription.
          </p>
          <p>
            Questions? Hit the chat bubble inside PRIM or email{' '}
            <a href="mailto:juantrejo9082@gmail.com" className="text-indigo-600 hover:underline">
              juantrejo9082@gmail.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
