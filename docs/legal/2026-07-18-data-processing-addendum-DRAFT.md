# PRIM — Data Processing Addendum (DPA) (DRAFT)

> **⚠️ DRAFT FOR REVIEW — NOT LEGAL ADVICE.** This is the vendor/data-security addendum
> your business customers (agents/agencies) will ask you to sign, and which their
> GLBA Safeguards Rule and (in ~25 states) insurance data-security obligations require
> them to obtain from vendors. It also positions PRIM as a trustworthy vendor.
> Fill `[[BRACKETS]]`; **[ATTORNEY]** review recommended before offering it for signature.

**Effective date:** [[EFFECTIVE DATE]]

This Data Processing Addendum ("DPA") supplements the PRIM Terms of Service between
**R&J Prime Consultancy LLC** ("R&J Prime," "Processor") and the customer accepting it
("Agent," "Controller"). It governs R&J Prime's processing of personal information the
Agent submits to PRIM about the Agent's prospects and clients ("Client Data"). If the
Terms and this DPA conflict as to Client Data, this DPA controls.

## 1. Roles

The Agent is the **controller / responsible party** for Client Data and determines the
purposes and means of processing. R&J Prime is the Agent's **processor / service
provider**, processing Client Data only to provide the Service and only on the Agent's
documented instructions (which include the Terms, this DPA, and use of the Service's
features). R&J Prime will not "sell" or "share" Client Data (as those terms are defined
under applicable privacy law) or use it for its own purposes, including advertising.

## 2. Nature of processing

- **Subject matter/duration:** for the term of the Agent's PRIM subscription.
- **Purpose:** hosting, storing, organizing, extracting, and displaying Client Data,
  and enabling communications the Agent chooses to send.
- **Data subjects:** the Agent's prospects and clients.
- **Data categories:** contact details, demographic/qualifying details (e.g., date of
  birth, income band, ZIP/state), lead source, insurance/policy details, notes,
  general health-interest indicators, and communication history the Agent syncs in.

## 3. Agent (controller) responsibilities

The Agent represents and warrants that it: (a) has the right, notices, and consents to
provide Client Data to R&J Prime and to have it processed; (b) is responsible for the
lawfulness of its collection and outreach (including TCPA/FTSA/CAN-SPAM consent); and
(c) will not submit Protected Health Information or prohibited content (see the Terms).

## 4. R&J Prime (processor) obligations

R&J Prime will:
1. **Process on instructions.** Process Client Data only per the Agent's instructions
   and applicable law, and inform the Agent if an instruction appears unlawful.
2. **Confidentiality.** Limit access to personnel who need it and are bound by
   confidentiality.
3. **Security.** Maintain a written information-security program with administrative,
   technical, and physical safeguards appropriate to the risk, consistent with the
   **GLBA Safeguards Rule (16 C.F.R. Part 314)** framework, including those in
   Schedule B.
4. **Subprocessors.** Use only the subprocessors listed in Schedule A to process Client
   Data, impose data-protection and security terms on them at least as protective as
   this DPA, remain responsible for their performance, and give the Agent notice of a
   new subprocessor with a reasonable opportunity to object.
5. **Breach notice.** Notify the Agent **without undue delay and in any event within
   [[72 HOURS]]** after confirming a security breach affecting the Agent's Client Data,
   with the information reasonably available, so the Agent can meet its own regulatory
   notification deadlines. [ATTORNEY: align the number with the strictest state
   insurance-regulator deadline your customers face — many require 72 hours.]
6. **Assist the Agent.** Provide reasonable assistance with (a) responses to data-
   subject requests routed to the Agent, and (b) the Agent's own breach-notification,
   security-assessment, and regulatory obligations, taking into account the information
   available to R&J Prime.
7. **Return/deletion.** On termination, and on the Agent's request, delete or return
   Client Data within a reasonable period, except copies required by law or retained by
   subprocessors under their own schedules.
8. **Audit.** Make available information reasonably necessary to demonstrate compliance
   with this DPA and, on reasonable notice and confidentiality terms, cooperate with a
   proportionate audit or provide a written security overview in lieu of on-site audit.

## 5. Miscellaneous

This DPA is governed by the law and venue in the Terms. Liability under this DPA is
subject to the limitations in the Terms. This DPA takes effect when the Agent accepts
it or continues using the Service after it is offered.

---

## Schedule A — Subprocessors

| Subprocessor | Purpose | Location |
|---|---|---|
| Supabase, Inc. | Database, authentication, file storage | AWS, United States |
| Vercel, Inc. | Application hosting/compute | United States |
| Stripe, Inc. | Subscription billing (holds card data; PRIM does not) | United States |
| Resend (Plus Five Five, Inc.) | Transactional and outreach email delivery | United States |
| Anthropic, PBC | AI extraction/organization of provided content | United States |
| TextDrip | Sync of the Agent's own contacts/message history into PRIM | United States |
| Ringy; Benepath; the Agent's website form provider | Inbound lead intake the Agent routes to PRIM | United States |
| Google/Apple/Mozilla push services | Optional browser reminder notifications (no names) | Varies |

## Schedule B — Security measures (summary)

- **Access & isolation:** database row-level security isolating each account's data;
  authentication required on all data endpoints; least-privilege staff access.
- **Encryption:** in transit (HTTPS/TLS); at rest via the storage provider. [INTERNAL:
  add "encryption of stored integration credentials" once implemented — currently a
  known gap for the TextDrip key.]
- **Application security:** signature verification on payment/email webhooks;
  server-side handling of secret keys; security headers.
- **Operational:** logging/monitoring; a written incident-response plan with breach
  timelines; periodic dependency vulnerability review. [INTERNAL: finalize the written
  IR plan and admin MFA to make this fully accurate.]

---

### Reviewer notes (remove before publishing)
- This DPA references safeguards we should finish implementing so the representations
  are true: (1) encrypt the stored TextDrip API key, (2) a written incident-response
  plan, (3) admin MFA. Tracked separately.
- The **[[72 HOURS]]** breach-notice figure should match the strictest deadline your
  customers' states impose (NAIC model = 72 hours to the commissioner).
