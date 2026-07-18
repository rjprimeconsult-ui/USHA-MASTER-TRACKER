'use client';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LEGAL, mailingAddressOrPlaceholder } from '@/lib/legalConfig.mjs';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 mb-8">
          <ArrowLeft size={14} /> Back to PRIM
        </Link>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-1">Effective date: {LEGAL.effectiveDate}</p>
        <p className="text-sm text-slate-500 mb-8">
          <strong>Operator:</strong> {LEGAL.company} (&quot;R&amp;J Prime,&quot; &quot;we,&quot; &quot;us,&quot; &quot;our&quot;), a Florida
          limited liability company, which operates the PRIM application (&quot;PRIM,&quot; &quot;the Service&quot;).
        </p>

        <div className="prose prose-slate max-w-none space-y-6 text-slate-700">
          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">1. Who this policy is for, and our two roles</h2>
            <p>
              PRIM is a business tool for licensed insurance agents. Two different kinds of data
              flow through it, and we play a different role for each:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Your account and billing data &mdash; we are the &quot;controller.&quot;</strong> This is information
                about <em>you, the agent</em> (your login, subscription, and how you use PRIM).
              </li>
              <li>
                <strong>Your clients&apos; and prospects&apos; information &mdash; we are a &quot;processor&quot; / &quot;service
                provider.&quot;</strong> When you enter or import the personal information of your prospects
                and clients, <strong>you</strong> decide what to collect and why; we simply store and process it
                on your behalf, under your instructions and our Terms of Service. You are
                responsible for having the right to collect that information and for how you use it.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">2. Information we collect</h2>
            <p><strong>A. Account &amp; billing information (about you, the agent)</strong></p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                Email address and a securely hashed password (managed by our authentication
                provider, Supabase; we never see your plaintext password).
              </li>
              <li>
                Optional profile details you add (display name, business/agency details, sender
                identity for emails, phone number).
              </li>
              <li>
                Subscription and billing status. <strong>Card payments are handled entirely by Stripe on
                Stripe-hosted pages &mdash; we do not receive or store your full card number.</strong> We store
                only your Stripe customer identifier and subscription status (plan, trial, renewal).
              </li>
              <li>
                Basic usage and diagnostic logs (e.g., page views and error logs) for security and
                troubleshooting.
              </li>
            </ul>
            <p><strong>B. Client &amp; prospect information (that you enter or import)</strong></p>
            <p>Depending on how you use PRIM, this can include your prospects&apos; and clients&apos;:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Contact details &mdash; name, phone number, email, address, ZIP, state, time zone.</li>
              <li>
                Demographic/qualifying details &mdash; date(s) of birth, age, income or income band,
                household/coverage information, lead source.
              </li>
              <li>
                <strong>General health-interest indicators</strong> &mdash; e.g., a flag that a person &quot;has health
                concerns&quot; or is interested in specific coverage. <strong>PRIM is not designed to hold
                clinical or medical records</strong> (see Section 8), but free-text notes and certain
                imported fields <em>can</em> contain health-related information you enter.
              </li>
              <li>
                Insurance and sales details &mdash; quotes, policy numbers, product types, effective
                dates, commissions, and pipeline/stage notes.
              </li>
              <li>
                <strong>Communication history you sync into PRIM</strong> &mdash; for example, text-message
                conversation history imported from your TextDrip or Ringy account so you can see it
                alongside a contact. <strong>PRIM does not send text messages or place phone calls;</strong> it
                displays history you sync from those separate tools.
              </li>
              <li>Documents you upload &mdash; commission statements, screenshots, and attachments.</li>
            </ul>
            <p><strong>C. How this information reaches us</strong></p>
            <p>
              Directly from you; from your lead sources via web-form and vendor webhooks (e.g.,
              Ringy, Benepath, your own website forms); and via our AI document-parsing feature,
              which reads statements and screenshots you upload to extract data fields for you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">3. How we use information</h2>
            <p>
              We use information to provide and operate PRIM: to store and organize your leads and
              books, run your CPA/commission calculations, extract data from documents you upload,
              enable the emails you choose to send, process your subscription, secure the Service,
              and provide support. We do <strong>not</strong> sell your information or your clients&apos; information,
              and we do <strong>not</strong> use it for cross-context behavioral advertising.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">4. AI processing of your documents and data</h2>
            <p>
              To power features like Smart Import and statement parsing, content you upload or
              provide (for example, commission statements, prospect import files, screenshots,
              synced message transcripts, and assistant chats) is sent to our AI provider,
              <strong> Anthropic (the Claude API)</strong>, to extract or organize data for you. Under Anthropic&apos;s
              commercial API terms, <strong>this content is not used to train AI models and is not
              retained beyond what is technically necessary to process your request.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">5. Who we share information with (service providers / subprocessors)</h2>
            <p>
              We share information only with vendors that help us run PRIM, and only as needed to
              provide the Service. We do not sell it. Our current providers:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-slate-200 py-2 pr-4 text-left">Provider</th>
                    <th className="border-b border-slate-200 py-2 pr-4 text-left">What they handle</th>
                    <th className="border-b border-slate-200 py-2 pr-4 text-left">Location</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left"><strong>Supabase</strong></td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Primary database, authentication, and file storage (all app data)</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">AWS, United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left"><strong>Vercel</strong></td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Application hosting and compute</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left"><strong>Stripe</strong></td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Subscription billing and card processing (<strong>Stripe holds card data; we do not</strong>)</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left"><strong>Resend</strong></td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Sending the emails you send or that the Service sends (welcome, reminders, outreach, support)</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left"><strong>Anthropic (Claude API)</strong></td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">AI parsing/extraction of documents and data you provide (Section 4)</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left"><strong>TextDrip</strong></td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Syncing your contacts and message history <em>from your own TextDrip account</em> into PRIM</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left"><strong>Ringy / Benepath / website lead forms</strong></td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Receiving lead information you route to PRIM via webhooks</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left"><strong>Web push services (Google/Apple/Mozilla)</strong></td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Delivering optional browser reminder notifications (no names sent)</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Varies</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              We do not share client/prospect data with any third party for that third party&apos;s own
              marketing. We may disclose information if required by law, to protect our rights or
              users&apos; safety, or in connection with a business transfer (e.g., merger or
              acquisition), in which case we will require the recipient to honor this policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">6. Where your data is stored</h2>
            <p>
              Your data is stored and processed in the <strong>United States</strong> (Supabase on Amazon Web
              Services; Vercel). Each account&apos;s data is isolated by database row-level security so
              other PRIM customers cannot access it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">7. Cookies, local storage, and analytics</h2>
            <p>
              We use a single authentication session to keep you signed in. To let the app work
              quickly and offline, PRIM also stores a copy of your working data &mdash; which can include
              client/prospect information &mdash; in your browser&apos;s local storage on your device; this is
              cleared when you switch accounts or sign out. We register a service worker to deliver
              optional reminder notifications. <strong>We do not use third-party advertising cookies or
              tracking pixels, and we do not run third-party web analytics.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">8. Health information and HIPAA</h2>
            <p>
              <strong>PRIM is not a HIPAA-covered entity or business associate, and is not intended to
              create, receive, or store Protected Health Information (PHI) or clinical records.</strong> We
              ask you to record only general impressions (e.g., &quot;has health concerns&quot;), not clinical
              specifics such as diagnoses, medication names, or treatment details. You are
              responsible for the health-related information you choose to enter. See our Terms of
              Service for the full restriction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">9. How we protect information</h2>
            <p>
              We use reasonable administrative and technical safeguards, including: encryption in
              transit (HTTPS), database row-level access isolation, authentication on all data
              endpoints, signature verification on payment and email webhooks, and restricted,
              server-side handling of secret keys. No system is perfectly secure, and we cannot
              guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">10. Our staff&apos;s access</h2>
            <p>
              To provide support and keep PRIM running, authorized R&amp;J Prime staff may access
              account data, and may securely access the application on your behalf to troubleshoot
              issues. We limit this to what is needed for support, operations, and security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">11. Data retention and deletion</h2>
            <p>
              We keep your data for as long as your account is active. <strong>To export or delete your
              data, or to close your account, email <a href={`mailto:${LEGAL.contactEmail}`} className="text-indigo-600 hover:underline">{LEGAL.contactEmail}</a>.</strong> We will act on verified
              requests within a reasonable time. Please note that copies held by our service
              providers (for example, Stripe billing records and Resend email logs) are retained
              under their own schedules, and information you synced from other tools (such as
              message history from TextDrip) remains subject to those tools as well.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">12. Your choices and rights</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Your account data:</strong> email <a href={`mailto:${LEGAL.contactEmail}`} className="text-indigo-600 hover:underline">{LEGAL.contactEmail}</a> to access, correct, export, or delete
                it, or to close your account.
              </li>
              <li>
                <strong>Your clients&apos;/prospects&apos; data:</strong> because you control that information and we only
                process it for you, requests from <em>your</em> clients or prospects (to access, correct,
                or delete their information) should be directed to <strong>you</strong>; we will help you fulfill
                them.
              </li>
              <li>
                <strong>Emails from us or sent through PRIM:</strong> every commercial/outreach email includes an
                unsubscribe link and our mailing address; you and your recipients can opt out at any
                time, and we honor opt-outs promptly.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">13. Children&apos;s privacy</h2>
            <p>
              PRIM is a business tool intended for licensed adult professionals. It is not directed
              to children under 13, and we do not knowingly collect personal information from
              children. If you believe a child&apos;s information has been provided to us, contact us and
              we will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">14. Residents of California and other states</h2>
            <p>
              PRIM is intended for agents operating in the states we serve, which <strong>do not include
              California</strong>, and we do not target California residents. Depending on where you or your
              contacts are located, additional state privacy rights may apply; contact us and we
              will work with you in good faith.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">15. Changes to this policy</h2>
            <p>
              We may update this policy as PRIM evolves. We will post the updated version here with a
              new effective date and, for material changes, provide notice within the app or by
              email.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">16. Contact us</h2>
            <p>
              {LEGAL.company}<br/>
              Attn: {LEGAL.attn}<br/>
              {mailingAddressOrPlaceholder()}<br/>
              <a href={`mailto:${LEGAL.contactEmail}`} className="text-indigo-600 hover:underline">{LEGAL.contactEmail}</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
