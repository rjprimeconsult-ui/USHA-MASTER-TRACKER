# R&J Prime Consultancy LLC — Written Information Security Program (WISP)

> **Operator:** R&J Prime Consultancy LLC, d/b/a PRIM. **Purpose:** a written,
> factual record of the administrative, technical, and physical safeguards
> protecting the personal information PRIM's agents and their clients/prospects
> entrust to the Service. This is the document a cyber-liability broker, a
> USHA compliance contact, or a state regulator asks for when they say
> "do you have a WISP." **Draft — Juan to review, sign, and date; re-review
> at least annually or after any material change to the system.**
>
> This WISP exists because the Privacy Policy (§9) and the DPA (Schedule A
> "Security measures") already make representations to agents about how their
> data is protected — this document is what makes those representations true,
> in writing, with an owner and a review date. Keep it in sync with those two
> documents; if a control described here changes, update all three.

---

## 1. Scope and purpose

This WISP applies to all personal information PRIM collects, stores, processes,
or transmits, including:

- **Agent account data** — email, hashed password (managed by Supabase Auth),
  business/agency details, sender identity, subscription/billing status
  (Stripe customer ID only — PRIM never holds card numbers).
- **Client and prospect data** entered or imported by agents — contact
  details, insurance-shopping details (coverage type, plan interest, general
  health-interest flags), commission/financial figures, and conversation
  history synced from an agent's own TextDrip account.
- **PRIM does not knowingly collect or store Protected Health Information
  (PHI) or Social Security numbers.** The "health notes" field is a general,
  non-clinical impression (e.g., "no major conditions") by design — see §7.

This program is scaled to R&J Prime Consultancy LLC's actual size and
operations: a solo-operator LLC running a single, cloud-hosted SaaS product
on a small number of named vendors (§4), not a program written for a
company with employees, offices, or physical records. Sections that
reference "staff" apply if/when the company has any employee or contractor
with system access beyond the owner.

## 2. Program owner and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **Information Security Coordinator (owner)** | Juan Trejo, R&J Prime Consultancy LLC | Owns this WISP; approves new vendors/subprocessors; reviews and updates the program at least annually; is the point of contact for a security incident (see the Incident Response Plan) and for agent/regulator/broker inquiries about this program. |

At present, Juan Trejo is the only individual with administrative access to
PRIM's systems. If R&J Prime Consultancy LLC engages any employee,
contractor, or subprocessor with system access, this WISP is updated to add
onboarding/offboarding and access-review procedures for that person before
access is granted.

## 3. Risk assessment (informal, current as of this draft)

Reasonably foreseeable internal and external risks to the personal
information PRIM holds, and how each is currently addressed:

| Risk | Mitigation | Status |
|---|---|---|
| Compromised owner/admin credentials | Strong, unique password + Supabase Auth; **MFA on the admin account** | ⚠️ **GAP — see §9, priority action** |
| Compromised agent credentials | Supabase Auth (hashed passwords, never stored in plaintext); **leaked-password protection** (rejects known-breached passwords at signup/reset) | ⚠️ **GAP — see §9, priority action** |
| Unauthorized cross-account data access | Postgres Row-Level Security (RLS) on every data table, scoped to auth.uid() — an agent's queries can only return that agent's own rows; verified programmatically (65 auth.uid()-scoped policies as of this draft) | ✅ In place |
| Privilege escalation via client-writable columns | profiles.is_admin and profiles.is_complimentary are excluded from the client-writable RLS surface (see the privilege-lockdown migration) — an agent cannot grant themselves admin or complimentary status by editing their own row | ✅ In place (verify the lockdown migration is applied in production — see §9) |
| Stolen/leaked payment card data | PRIM never receives or stores full card numbers — all card collection happens on Stripe-hosted Checkout pages; PRIM stores only a Stripe customer ID and subscription status | ✅ In place (by design — out of scope by architecture) |
| Forged/injected webhook requests (Stripe, Resend, inbound-lead webhooks) | Signature verification on Stripe and Resend webhooks; per-agent unguessable tokens on inbound-lead webhook URLs (Ringy/Benepath/webform) | ✅ In place |
| Interception of data in transit | HTTPS/TLS enforced on all application and API traffic (Vercel) | ✅ In place |
| Unauthorized access to data at rest | Encryption at rest via the database provider (Supabase/AWS); database credentials held only in server-side environment variables, never shipped to the browser | ✅ In place |
| Third-party integration credential theft | Agents' TextDrip API keys are currently stored in plaintext in user_kv | ⚠️ **GAP — tracked as task #51, see §9** |
| Vendor/subprocessor compromise | Subprocessor list is fixed and reviewed (Schedule A of the DPA); each handles a narrow, defined slice of data (see §4) | ✅ Monitored; formal vendor security review not yet performed — see §9 |
| Accidental data exposure via AI processing | Only the minimum content needed for a specific extraction task is sent to Anthropic's API per request; PRIM does not send bulk data exports to any AI provider; raw SMS/statement content sent for parsing is not persisted by the AI provider beyond the request (per Anthropic's API terms) | ✅ In place by design |
| Loss of the owner's device/credentials (business continuity) | Source code and infrastructure config are held in version control (GitHub) and the cloud vendors (Vercel/Supabase), not solely on the owner's local machine; vendor account recovery relies on the owner's registered email/phone | ⚠️ No documented account-recovery/succession plan — see §9 |

## 4. Vendors / subprocessors and what they handle

The complete, current list of third parties with access to personal
information handled by PRIM (identical to DPA Schedule A — kept in sync):

| Vendor | Handles | Location |
|---|---|---|
| Supabase, Inc. | Database, authentication, file storage — all app data | AWS, United States |
| Vercel, Inc. | Application hosting/compute | United States |
| Stripe, Inc. | Subscription billing (holds card data; PRIM does not) | United States |
| Resend (Plus Five Five, Inc.) | Transactional and outreach email delivery | United States |
| Anthropic, PBC | AI extraction/organization of agent-provided content | United States |
| TextDrip | Sync of the agent's own contacts/message history into PRIM | United States |
| Ringy; Benepath; agent website form providers | Inbound lead intake the agent routes to PRIM via webhook | United States |
| Google/Apple/Mozilla push services | Optional browser reminder notifications (no names sent) | Varies |

No vendor is added to this list, and no new category of data is sent to an
existing vendor, without the program owner's review of that vendor's
security posture and an update to this WISP and the DPA Schedule A.

## 5. Administrative safeguards

- **Access is need-based.** The only standing administrative access is the
  program owner (§2). Support access to an individual agent's account is
  taken only to resolve that agent's own request and is not standing access
  to all accounts beyond what is_admin already grants for support/ops
  (Privacy Policy §10).
- **Change control.** Code changes go through version control (git) with a
  record of what changed and why; production deployments happen through the
  hosting vendor's deployment pipeline (Vercel), not manual server edits.
- **Least necessary collection.** PRIM's health-notes field captures a
  general, non-clinical interest flag rather than clinical detail — a
  deliberate design decision to keep the product out of PHI territory (§7)
  rather than a promise layered on top of clinical data collection.
- **This WISP is reviewed** at least annually, and immediately after: a
  security incident, a material change to the system architecture, a new
  vendor/subprocessor, or a change in applicable law the program owner
  becomes aware of.

## 6. Technical safeguards

- **Encryption in transit:** HTTPS/TLS on all traffic to and from the
  application and its APIs.
- **Encryption at rest:** provided by the database vendor (Supabase, backed
  by AWS) for all stored application data.
- **Row-Level Security (RLS):** every data-bearing table restricts reads and
  writes to the owning agent via auth.uid(); no table returns another
  agent's rows by default.
- **Privileged-column lockdown:** self-service profile updates cannot alter
  is_admin or is_complimentary — those columns are excluded from what an
  agent's own session is allowed to write.
- **Webhook signature verification** on Stripe and Resend inbound events; the
  application rejects unsigned or invalid-signature payloads before
  processing them.
- **Secrets handling:** database service-role keys, the Stripe secret key,
  the Resend API key, and the Anthropic API key are held only in server-side
  environment variables (Vercel), never exposed to client-side code or
  committed to version control.
- **Server-side authorization checks** on every route that reads or writes
  personal information or spends a paid resource (AI extraction, outbound
  email) — the client UI's own gating is defense-in-depth, not the actual
  control.

## 7. No-PHI-by-design policy

PRIM is built and operated as a **no-PHI system**:

- The health-related field agents may log is a general, non-clinical
  impression (e.g., "no major conditions noted"), never a diagnosis code,
  medication list, or clinical detail.
- The meds field/concept is never read, displayed, or sent to any AI
  provider by any code path in the product.
- AI-generated follow-up drafts are built from an agent's own logged notes
  and are constrained by the system prompt to avoid clinical/medical
  specifics, matching the marketing representation that "PRIM does not
  practice medicine or handle PHI."
- This is treated as a product-design guardrail, not solely a policy
  statement — new features that touch the health-notes field are reviewed
  against this rule before shipping.

## 8. Incident response

Security incidents are handled per the separate
[Incident Response Plan](./2026-08-12-incident-response-plan-DRAFT.md),
which this WISP incorporates by reference. That plan covers detection,
containment, the notification triggers and deadlines relevant to PRIM
(NAIC-model insurance-data-security laws, Florida FIPA, the GLBA Safeguards
Rule breach-notification requirement), and post-incident review.

## 9. Known gaps and priority actions

This WISP is written to be **true today**, not aspirational — every checkmark
above reflects a control actually in place as of this draft. The gaps below
are tracked, owned, and should be closed in roughly this order:

| # | Gap | Why it matters | Owner | Target |
|---|---|---|---|---|
| 1 | No MFA on the admin/owner account | Single point of failure — a compromised owner password compromises every agent's data | Juan | Next available session |
| 2 | Supabase leaked-password protection not enabled | Lets an agent sign up or reset into a password already known to be breached elsewhere | Juan | Next available session |
| 3 | TextDrip API keys stored in plaintext (user_kv) | A database-read-level exposure would leak agents' TextDrip credentials directly (task #51 — needs a migration path for agents with an existing key, deliberately not rushed) | Juan + Claude Code | Design pass scheduled |
| 4 | No formal vendor security review on file | Can't yet produce "we reviewed each subprocessor's security posture" as a documented step, only "we chose reputable, named vendors" | Juan | Before a broker/regulator asks |
| 5 | No documented account-recovery/succession plan | If the owner is unreachable, there is no written procedure for regaining vendor account access | Juan | Low urgency, single-operator risk |
| 6 | Verify the privilege-lockdown migration is applied in **production**, not just designed | The RLS gap it closes (self-granted is_admin) is the highest-severity item on this list if it were ever left open | Juan | Verify this week — one query |

**When gaps 1-2 close, update §3's status marks and this table in the same
commit/session — this document is only useful if it stays accurate.**

---

### Reviewer notes (remove before finalizing)
- This is a solo-operator-scaled WISP, not a template written for a company
  with HR, physical offices, or a security team — if R&J Prime Consultancy
  LLC hires anyone with system access, add onboarding/offboarding and
  training sections before that happens, not after.
- A cyber-liability broker or a state examiner may want this WISP to
  reference specific frameworks (e.g., NIST CSF, the FTC Safeguards Rule's
  required elements) by name — ask counsel/broker whether that mapping is
  worth adding once you're quoting coverage.
- Keep this document, the Privacy Policy §9, and the DPA "Security measures"
  section saying the same thing. A regulator or plaintiff's attorney will
  compare them.
