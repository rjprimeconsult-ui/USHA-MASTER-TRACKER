# PRIM — Privacy Policy (DRAFT)

> **⚠️ DRAFT FOR REVIEW — NOT YET LIVE.** This draft was written to accurately match
> PRIM's real data practices (verified against the codebase) and the U.S./Florida
> frameworks that apply. **It is not legal advice.** Before publishing, (1) fill the
> `[[BRACKETED]]` placeholders, and (2) have a Florida attorney do a short final pass
> on the items flagged **[ATTORNEY]** below.
>
> **Placeholders to fill:** `[[MAILING ADDRESS]]` (a real physical postal address is
> also required by CAN-SPAM for your emails), `[[EFFECTIVE DATE]]`.

---

**Effective date:** [[EFFECTIVE DATE]]
**Operator:** R&J Prime Consultancy LLC ("R&J Prime," "we," "us," "our"), a Florida
limited liability company, which operates the PRIM application ("PRIM," "the Service").

## 1. Who this policy is for, and our two roles

PRIM is a business tool for licensed insurance agents. Two different kinds of data
flow through it, and we play a different role for each:

- **Your account and billing data — we are the "controller."** This is information
  about *you, the agent* (your login, subscription, and how you use PRIM).
- **Your clients' and prospects' information — we are a "processor" / "service
  provider."** When you enter or import the personal information of your prospects
  and clients, **you** decide what to collect and why; we simply store and process it
  on your behalf, under your instructions and our Terms of Service. You are
  responsible for having the right to collect that information and for how you use it.

## 2. Information we collect

**A. Account & billing information (about you, the agent)**
- Email address and a securely hashed password (managed by our authentication
  provider, Supabase; we never see your plaintext password).
- Optional profile details you add (display name, business/agency details, sender
  identity for emails, phone number).
- Subscription and billing status. **Card payments are handled entirely by Stripe on
  Stripe-hosted pages — we do not receive or store your full card number.** We store
  only your Stripe customer identifier and subscription status (plan, trial, renewal).
- Basic usage and diagnostic logs (e.g., page views and error logs) for security and
  troubleshooting.

**B. Client & prospect information (that you enter or import)**
Depending on how you use PRIM, this can include your prospects' and clients':
- Contact details — name, phone number, email, address, ZIP, state, time zone.
- Demographic/qualifying details — date(s) of birth, age, income or income band,
  household/coverage information, lead source.
- **General health-interest indicators** — e.g., a flag that a person "has health
  concerns" or is interested in specific coverage. **PRIM is not designed to hold
  clinical or medical records** (see Section 8), but free-text notes and certain
  imported fields *can* contain health-related information you enter.
- Insurance and sales details — quotes, policy numbers, product types, effective
  dates, commissions, and pipeline/stage notes.
- **Communication history you sync into PRIM** — for example, text-message
  conversation history imported from your TextDrip or Ringy account so you can see it
  alongside a contact. **PRIM does not send text messages or place phone calls;** it
  displays history you sync from those separate tools.
- Documents you upload — commission statements, screenshots, and attachments.

**C. How this information reaches us**
Directly from you; from your lead sources via web-form and vendor webhooks (e.g.,
Ringy, Benepath, your own website forms); and via our AI document-parsing feature,
which reads statements and screenshots you upload to extract data fields for you.

## 3. How we use information

We use information to provide and operate PRIM: to store and organize your leads and
books, run your CPA/commission calculations, extract data from documents you upload,
enable the emails you choose to send, process your subscription, secure the Service,
and provide support. We do **not** sell your information or your clients' information,
and we do **not** use it for cross-context behavioral advertising.

## 4. AI processing of your documents and data

To power features like Smart Import and statement parsing, content you upload or
provide (for example, commission statements, prospect import files, screenshots,
synced message transcripts, and assistant chats) is sent to our AI provider,
**Anthropic (the Claude API)**, to extract or organize data for you. Under Anthropic's
commercial API terms, **this content is not used to train AI models and is not
retained beyond what is technically necessary to process your request.** [ATTORNEY /
CONFIRM: verify the specific Claude model in use does not fall under a longer
retention category, and update this sentence if it does.]

## 5. Who we share information with (service providers / subprocessors)

We share information only with vendors that help us run PRIM, and only as needed to
provide the Service. We do not sell it. Our current providers:

| Provider | What they handle | Location |
|---|---|---|
| **Supabase** | Primary database, authentication, and file storage (all app data) | AWS, United States |
| **Vercel** | Application hosting and compute | United States |
| **Stripe** | Subscription billing and card processing (**Stripe holds card data; we do not**) | United States |
| **Resend** | Sending the emails you send or that the Service sends (welcome, reminders, outreach, support) | United States |
| **Anthropic (Claude API)** | AI parsing/extraction of documents and data you provide (Section 4) | United States |
| **TextDrip** | Syncing your contacts and message history *from your own TextDrip account* into PRIM | United States |
| **Ringy / Benepath / website lead forms** | Receiving lead information you route to PRIM via webhooks | United States |
| **Web push services (Google/Apple/Mozilla)** | Delivering optional browser reminder notifications (no names sent) | Varies |

We do not share client/prospect data with any third party for that third party's own
marketing. We may disclose information if required by law, to protect our rights or
users' safety, or in connection with a business transfer (e.g., merger or
acquisition), in which case we will require the recipient to honor this policy.

## 6. Where your data is stored

Your data is stored and processed in the **United States** (Supabase on Amazon Web
Services; Vercel). Each account's data is isolated by database row-level security so
other PRIM customers cannot access it.

## 7. Cookies, local storage, and analytics

We use a single authentication session to keep you signed in. To let the app work
quickly and offline, PRIM also stores a copy of your working data — which can include
client/prospect information — in your browser's local storage on your device; this is
cleared when you switch accounts or sign out. We register a service worker to deliver
optional reminder notifications. **We do not use third-party advertising cookies or
tracking pixels, and we do not run third-party web analytics.**

## 8. Health information and HIPAA

**PRIM is not a HIPAA-covered entity or business associate, and is not intended to
create, receive, or store Protected Health Information (PHI) or clinical records.** We
ask you to record only general impressions (e.g., "has health concerns"), not clinical
specifics such as diagnoses, medication names, or treatment details. You are
responsible for the health-related information you choose to enter. See our Terms of
Service for the full restriction. [ATTORNEY: confirm the "general health-interest
flag" handling does not itself trigger state consumer-health-data laws for the states
you operate in.]

## 9. How we protect information

We use reasonable administrative and technical safeguards, including: encryption in
transit (HTTPS), database row-level access isolation, authentication on all data
endpoints, signature verification on payment and email webhooks, and restricted,
server-side handling of secret keys. No system is perfectly secure, and we cannot
guarantee absolute security. [ATTORNEY / INTERNAL: keep this description in line with
the actual controls; see the separate security-hardening items — e.g., encrypting
stored integration keys and adding admin MFA — before making stronger claims.]

## 10. Our staff's access

To provide support and keep PRIM running, authorized R&J Prime staff may access
account data, and may securely access the application on your behalf to troubleshoot
issues. We limit this to what is needed for support, operations, and security.

## 11. Data retention and deletion

We keep your data for as long as your account is active. **To export or delete your
data, or to close your account, email [[CONTACT EMAIL]].** We will act on verified
requests within a reasonable time. Please note that copies held by our service
providers (for example, Stripe billing records and Resend email logs) are retained
under their own schedules, and information you synced from other tools (such as
message history from TextDrip) remains subject to those tools as well.
[INTERNAL: today, deletion/export is a manual process — set a realistic response
window here, and consider building self-serve export/delete.]

## 12. Your choices and rights

- **Your account data:** email [[CONTACT EMAIL]] to access, correct, export, or delete
  it, or to close your account.
- **Your clients'/prospects' data:** because you control that information and we only
  process it for you, requests from *your* clients or prospects (to access, correct,
  or delete their information) should be directed to **you**; we will help you fulfill
  them.
- **Emails from us or sent through PRIM:** every commercial/outreach email includes an
  unsubscribe link and our mailing address; you and your recipients can opt out at any
  time, and we honor opt-outs promptly.

## 13. Children's privacy

PRIM is a business tool intended for licensed adult professionals. It is not directed
to children under 13, and we do not knowingly collect personal information from
children. If you believe a child's information has been provided to us, contact us and
we will delete it.

## 14. Residents of California and other states

PRIM is intended for agents operating in the states we serve, which **do not include
California**, and we do not target California residents. Depending on where you or your
contacts are located, additional state privacy rights may apply; contact us and we
will work with you in good faith. [ATTORNEY: confirm treatment given leads can arrive
via webhooks from mixed locations.]

## 15. Changes to this policy

We may update this policy as PRIM evolves. We will post the updated version here with a
new effective date and, for material changes, provide notice within the app or by
email.

## 16. Contact us

R&J Prime Consultancy LLC
Attn: Juan Trejo
[[MAILING ADDRESS]]
[[CONTACT EMAIL]]

---

### Reviewer notes (remove before publishing)
- **[[MAILING ADDRESS]]** is required — CAN-SPAM requires a valid physical postal
  address in your commercial emails, and a contact address here is expected. A P.O.
  box or registered-agent/commercial mail-receiving address is acceptable.
- **[[CONTACT EMAIL]]** — decide between `rjprimeconsult@gmail.com` (current) and a
  branded address like `privacy@primtracker.com`.
- Items marked **[ATTORNEY]** are genuine legal judgment calls, not drafting gaps.
- This policy must stay in sync with two things we still need to do so it's *true*:
  the CAN-SPAM email footer (Section 12) and the security items (Section 9).
