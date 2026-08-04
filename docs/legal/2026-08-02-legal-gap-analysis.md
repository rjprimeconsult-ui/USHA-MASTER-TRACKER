# PRIM — Legal & Compliance Gap Analysis

**Date:** 2026-08-02
**Prepared for:** Juan Trejo / R&J Prime Consultancy LLC
**Method:** Every claim in the Privacy Policy, Terms of Service, and DPA was checked against the actual production code and live data. Findings are evidence-backed with file:line references.

> **This is not legal advice.** I am not a lawyer. What this document does is answer the engineering question — *does what we promise match what the software does?* — so that an attorney's time is spent on judgment calls, not fact-finding. Every item marked **[ATTORNEY]** needs a licensed Florida attorney with SaaS/privacy experience.

---

## Bottom line

**The documents are genuinely good.** They are not internet templates — they contain PRIM-specific reasoning a template would never produce: the controller/processor split, a real subprocessor table, the no-PHI carve-out, GLBA Safeguards framing (the correct regime for insurance data rather than generic "industry standard" language), and an explicit TCPA disclaimer.

**Nine of eleven factual claims I could test are TRUE.** That is unusually good. The problems are not in the drafting — they are in three places where the *paper* is ahead of the *practice*, and one place where the strongest protections may not be enforceable at all.

| Verified claim | Result |
|---|---|
| "PRIM does not send text messages or place calls" (Terms §4, Privacy §2B) | ✅ **TRUE** — TextDrip integration is read-only (`connect/disconnect/extract-conversation/status/sync`, no send endpoint); the Ringy webhook *receives* blast events and increments a counter (`ringy/webhook/[token]/route.js:36`). No outbound SMS anywhere. |
| "We do not run third-party web analytics / no ad cookies" (Privacy §7) | ✅ **TRUE** — zero analytics packages in `package.json`; Vercel Analytics and Speed Insights both confirmed *Not Enabled*. |
| Subprocessor list is complete (Privacy §5, DPA Sch. A) | ✅ **TRUE for personal data** — the only outbound hosts are Resend, TextDrip, Supabase, Stripe, Anthropic (all disclosed). See Finding 7 re: Slack. |
| "Card data handled by Stripe; we never store card numbers" | ✅ **TRUE** — Stripe-hosted checkout; only customer id + status stored. |
| Anthropic is the only AI provider (Privacy §4, Terms §6) | ✅ **TRUE** — `@anthropic-ai/sdk` only; no OpenAI/Google/other AI SDK present. |
| OCR/PDF/spreadsheet parsing | ✅ Client-side (`tesseract.js`, `pdfjs-dist`, `mammoth`, `papaparse`) — this data does **not** leave the browser for parsing. Better than the policy claims. |
| "We do not target California residents" (Privacy §14) | ✅ **TRUE today** — 0 of 166 live records are CA. See Finding 8 (it is a claim that will age). |
| Row-level isolation between accounts (Privacy §6) | ✅ **TRUE** — Supabase RLS; verified in prior sessions. |
| "Every commercial email includes unsubscribe + physical address" (Privacy §12) | ⚠️ **TRUE AS OF TODAY** — enforced at send time by the sender-identity gate shipped 2026-08-02. It was *not* reliably true before today. |

---

## Findings, ranked by exposure

### 🔴 1. The Terms are almost certainly unenforceable as written — no acceptance at signup

**Evidence:** `src/components/auth/AuthGate.jsx:70` — account creation is `supabase.auth.signUp({ email, password })`. There is **no checkbox, no "by signing up you agree," and no link to the Terms or Privacy Policy anywhere on the signup screen.** Grep confirms the only legal links in the entire app are in the post-login footer (`LeadTracker.jsx:2524-2526`) and inside the PHI banner (`NoPhiBanner.jsx:73`).

**Why this is the top finding:** Terms §11 caps your liability at "the greater of 12 months of fees or $50," and §12 makes the agent indemnify you for their own TCPA/CAN-SPAM violations. **Those two clauses are the entire reason this document protects you.** Courts enforce them only if the user had reasonable notice and manifested assent. What you have now is "browsewrap" with no notice at the point of signup — the weakest and most frequently struck-down form. The Terms themselves say *"By creating an account or using PRIM, you agree to these Terms"* (Terms, preamble) — but the account-creation screen never shows or mentions them.

**The irony worth naming:** you have an excellent indemnity clause protecting you from an agent's TCPA violation. TCPA statutory damages are $500–$1,500 *per message*. If that clause fails for lack of assent, the protection you most need is the one you lose.

**Fix (small, ~1 hour):** add to the signup form, directly above the submit button — *"By creating an account, you agree to the [Terms of Service] and [Privacy Policy]"* with real links. Stronger: an unchecked checkbox the user must tick, and store the acceptance (timestamp + document version) on the profile row so you can later *prove* who accepted what and when. I can build this.

**[ATTORNEY]** — confirm clickwrap vs. checkbox, and whether you want a version-stamped acceptance record.

---

### 🔴 2. Your published legal pages display a placeholder instead of your address

**Evidence:** `src/lib/legalConfig.mjs:12` — `mailingAddress: ''`. `mailingAddressOrPlaceholder()` therefore renders the literal string **`[mailing address — to be added]`** on Privacy §16, Terms §16, and the DPA contact block, live on primtracker.com right now.

**Why it matters:** it reads as unfinished to any agent or partner who scrolls down, and multiple state privacy statutes require a physical contact address in the policy. This is the last remnant of the ticket-#3 problem — the *email* path was fixed today by the sender-identity release, but the *legal pages* still show it.

**Fix (2 minutes):** set the real address in `legalConfig.mjs`. If you don't want your home address public, a registered-agent or virtual business address is the normal solution. Tell me the address and I'll ship it.

---

### 🟠 3. The DPA promises a written security program — does it exist on paper?

**Evidence:** DPA §4.3 commits R&J Prime to *"maintain a **written** information-security program … consistent with the **GLBA Safeguards Rule (16 C.F.R. Part 314)**."* DPA §4.5 promises breach notice **within 72 hours**. DPA §4.8 grants audit rights.

**Why it matters:** this is the sharpest version of your own concern — *the policy says one thing, the practice does another*. The Safeguards Rule contemplates specific artifacts: a designated qualified individual, a written risk assessment, a written incident-response plan, and periodic review. **If those documents don't exist, the DPA contains a factual misstatement you've contractually committed to** — and it's the first thing an opposing lawyer or a state regulator would ask for after an incident.

Same for the 72-hour clock: it's a good commitment, but only if you have a way to *detect* a breach and a pre-written notification path. Today there is no monitoring or IR runbook in the repo.

**Fix:** either (a) write the WISP + IR plan — this is genuinely achievable for a company your size, roughly a 6–10 page document, and I can draft the technical sections from what the code actually does (encryption in transit, RLS isolation, secret handling, auth on all endpoints, webhook signature verification — all of which are real and verified); or (b) soften the DPA language. **(a) is much better** — it's a sales asset with agencies and it's what the Safeguards Rule expects anyway.

**[ATTORNEY]** — whether R&J Prime is itself a "financial institution" under GLBA, or picks up obligations by flow-down from licensee agents.

---

### 🟠 4. Insurance-specific data security laws — the gap a generic template guarantees

**Evidence:** live data shows your agents' books span **TX (51), FL (21), GA (11), NC (8), OH (5), MD (5), TN (5), SC (4), MS (3), IL (3), WI (3)** and more.

**Why it matters:** roughly half the states have adopted a version of the **NAIC Insurance Data Security Model Law**, which imposes written-information-security-program and breach-notification duties on insurance *licensees* — and flows obligations down to their **third-party service providers**. PRIM is a third-party service provider to licensed agents in many of those states. A generic SaaS privacy template will never surface this; it is specific to the industry you serve. Several states in the list above are adopters.

**[ATTORNEY] — this is the single highest-value question to bring to counsel**, because it's the one where the answer might change your obligations rather than just your paperwork. Ask: *"Which of these states' insurance data security laws reach us as a service provider to licensed producers, and what do they require of us?"* I have deliberately not asserted which specific states apply — verify, don't take my word.

---

### 🟠 5. Cyber liability + technology E&O insurance — you asked, and this is the real answer

**Status:** no evidence of coverage; you raised it yourself.

**Why the liability cap is not a substitute:** Terms §11 caps what *your agents* can recover from you. It does **nothing** about (a) a *prospect or client* — someone who never signed your Terms — suing after a breach; (b) a state regulator; or (c) your own breach-response costs. You hold 166+ consumers' names, phone numbers, emails, dates of birth, income bands, and health-interest indicators. A breach of that is a notification event in every state, and notification alone (forensics, legal, mailing, credit monitoring) routinely runs into six figures before anyone sues.

**What to price:** **cyber liability** (first-party breach response + third-party claims) and **technology E&O** (claims that the software failed — e.g., a commission calculation error). These are often sold together for small SaaS. **[ATTORNEY]/broker** — your insurance broker can quote both; mention you store consumer PII including DOB and health-interest flags, and that you are a service provider to licensed insurance producers.

Worth noting: carriers will ask whether you have a WISP, MFA, and an IR plan. Finding 3 and Finding 9 directly affect your premium and eligibility.

---

### 🟡 6. Promises you must be able to operationally keep

**Evidence:** Privacy §11/§12 promise export, deletion, and account closure on emailed request. There is **no self-serve delete** in the app (grep confirms), which is legally fine — but the promise creates a duty.

**The question to answer honestly:** if an agent emailed today asking you to delete everything, could you do it completely — Supabase rows, storage bucket files, `user_kv` entries, and the localStorage mirror on their device? There's no documented runbook.

**Fix:** a short internal procedure (a checklist + the SQL), so the promise is one you can execute the same day. I can write it and test it against a scratch account.

---

### 🟡 7. Slack receives deploy notifications — disclosed nowhere, but almost certainly fine

**Evidence:** `hooks.slack.com` appears in `scripts/announce-deploy.mjs`; it posts the release headline to your team channel on production deploys.

**Assessment:** it transmits **commit messages only — no user or client data** — so it is not a subprocessor of personal information and does not belong in the Privacy §5 table. Recorded here only so the subprocessor list stays *knowingly* complete rather than accidentally so. **No action needed.**

---

### 🟡 8. Two claims that are true now but will age

- **California (Privacy §14).** True today: 0 CA records. But nothing in the product *prevents* a CA prospect from being imported tomorrow. Treat this as a claim with an expiry date, not a permanent fact. (Note: CCPA's business thresholds — ~$25M revenue / 100k consumers / data-selling — almost certainly don't reach you regardless, but the sentence should stay honest.) **[ATTORNEY]**
- **Geographic scope generally.** The Terms say nothing about where the Service is offered. The cleanest way to make the whole GDPR question disappear is a sentence stating PRIM is offered only to US-based licensed agents for US operations — see next finding.

---

### 🟡 9. GDPR — you asked; here's the honest read

**You almost certainly do not need GDPR compliance**, and adding it would be worse than not: a policy claiming GDPR rights you don't operationally provide (DSAR workflow, Art. 30 records, SCCs with every subprocessor, EU representative) is *more* dangerous than a policy that correctly scopes itself out.

**What you should do instead — this is the real fix:** state the scope explicitly. Add to the Terms: the Service is offered only to US-based licensed insurance professionals for US business, and is not directed to individuals in the EU/EEA/UK. That single sentence does more for you than a GDPR section would. **[ATTORNEY]** to word it.

*(If you ever take an EU-based agent or an agent starts working EU-resident leads, revisit immediately — that changes the answer.)*

---

### 🟢 10. Documents you asked about that you don't actually need

- **MSA (Master Service Agreement):** your Terms *are* your MSA for self-serve. You'd only need a separate negotiated MSA if you start selling **Team**-tier deals to agencies who redline contracts — worth having a template ready *then*, not now.
- **SLA:** you have none, and Terms §10 correctly disclaims uptime ("AS IS," no warranty of uninterrupted service). That's the right posture at your price point. An SLA becomes a sales asset when you chase larger agencies — and it must then be backed by real monitoring and service credits. Don't promise one before you can measure it.
- **Refund policy:** you *have* one — Terms §7: *"Except where required by law, fees are non-refundable,"* plus cancel-anytime and trial-converts-to-paid. That's complete and standard. One consistency check: confirm the trial length in Stripe matches the 7 days advertised in the paywall copy.
- **Cookie policy:** correctly folded into Privacy §7, and accurate given you run no ad tech.

---

### 🔵 11. Two things I found while looking (not legal)

- **The health-notes field is in heavy real use: 80 of 166 prospects (48%).** I sampled the content and it looks **compliant** — *"No known pre-existing conditions or specific medications," "Spouse has health condition managed with medication"* — general impressions, no diagnoses, no drug names. That's evidence your `NoPhiBanner` and field placeholder are actually working. But at 48% usage this is a live, high-traffic surface where one careless entry creates the exposure Terms §5 disclaims. **Suggestion:** a periodic automated scan for drug-name/diagnosis patterns that flags entries for review — cheap insurance, and it converts a promise into a control.
- **Data-quality bug: 15 records have `state` = `"4/7/01"`.** A date landed in the state field, almost certainly from an AI import mis-mapping. Not a legal issue, but state can drive compliance decisions — worth fixing. I can find the source and correct the records.

---

## Recommended order

| # | Action | Who | Effort |
|---|---|---|---|
| 1 | Add clickwrap acceptance + stored acceptance record at signup | Me | ~1 hr |
| 2 | Set the real mailing address in `legalConfig.mjs` | You → me | 2 min |
| 3 | Get cyber liability + tech E&O quotes | You + broker | — |
| 4 | Ask counsel the NAIC/state insurance-data-security question (Finding 4) | Attorney | — |
| 5 | Write the WISP + incident-response plan | Me (technical) + attorney (legal) | ~1 day |
| 6 | Add US-only scope sentence to Terms | Attorney | — |
| 7 | Write the data export/deletion runbook | Me | ~2 hrs |
| 8 | Health-notes PHI scanner | Me | ~3 hrs |
| 9 | Fix the 15 malformed `state` values | Me | ~1 hr |

**Do 1 and 2 this week.** They're small, they're entirely within your control, and #1 is what makes everything else in the Terms actually work.
