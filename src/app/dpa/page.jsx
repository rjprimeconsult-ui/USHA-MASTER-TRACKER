'use client';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LEGAL } from '@/lib/legalConfig.mjs';

export default function DpaPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 mb-8">
          <ArrowLeft size={14} /> Back to PRIM
        </Link>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Data Processing Addendum</h1>
        <p className="text-sm text-slate-500 mb-8">Effective date: {LEGAL.effectiveDate}</p>

        <div className="prose prose-slate max-w-none space-y-6 text-slate-700">
          <p>
            This Data Processing Addendum (&quot;DPA&quot;) supplements the PRIM Terms of Service between
            <strong> {LEGAL.company}</strong> (&quot;R&amp;J Prime,&quot; &quot;Processor&quot;) and the customer accepting it
            (&quot;Agent,&quot; &quot;Controller&quot;). It governs R&amp;J Prime&apos;s processing of personal information the
            Agent submits to PRIM about the Agent&apos;s prospects and clients (&quot;Client Data&quot;). If the
            Terms and this DPA conflict as to Client Data, this DPA controls.
          </p>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">1. Roles</h2>
            <p>
              The Agent is the <strong>controller / responsible party</strong> for Client Data and determines the
              purposes and means of processing. R&amp;J Prime is the Agent&apos;s <strong>processor / service
              provider</strong>, processing Client Data only to provide the Service and only on the Agent&apos;s
              documented instructions (which include the Terms, this DPA, and use of the Service&apos;s
              features). R&amp;J Prime will not &quot;sell&quot; or &quot;share&quot; Client Data (as those terms are defined
              under applicable privacy law) or use it for its own purposes, including advertising.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">2. Nature of processing</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Subject matter/duration:</strong> for the term of the Agent&apos;s PRIM subscription.</li>
              <li>
                <strong>Purpose:</strong> hosting, storing, organizing, extracting, and displaying Client Data,
                and enabling communications the Agent chooses to send.
              </li>
              <li><strong>Data subjects:</strong> the Agent&apos;s prospects and clients.</li>
              <li>
                <strong>Data categories:</strong> contact details, demographic/qualifying details (e.g., date of
                birth, income band, ZIP/state), lead source, insurance/policy details, notes,
                general health-interest indicators, and communication history the Agent syncs in.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">3. Agent (controller) responsibilities</h2>
            <p>
              The Agent represents and warrants that it: (a) has the right, notices, and consents to
              provide Client Data to R&amp;J Prime and to have it processed; (b) is responsible for the
              lawfulness of its collection and outreach (including TCPA/FTSA/CAN-SPAM consent); and
              (c) will not submit Protected Health Information or prohibited content (see the Terms).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">4. R&amp;J Prime (processor) obligations</h2>
            <p>R&amp;J Prime will:</p>
            <ol className="list-decimal pl-6 space-y-1">
              <li>
                <strong>Process on instructions.</strong> Process Client Data only per the Agent&apos;s instructions
                and applicable law, and inform the Agent if an instruction appears unlawful.
              </li>
              <li>
                <strong>Confidentiality.</strong> Limit access to personnel who need it and are bound by
                confidentiality.
              </li>
              <li>
                <strong>Security.</strong> Maintain a written information-security program with administrative,
                technical, and physical safeguards appropriate to the risk, consistent with the
                <strong> GLBA Safeguards Rule (16 C.F.R. Part 314)</strong> framework, including those in
                Schedule B.
              </li>
              <li>
                <strong>Subprocessors.</strong> Use only the subprocessors listed in Schedule A to process Client
                Data, impose data-protection and security terms on them at least as protective as
                this DPA, remain responsible for their performance, and give the Agent notice of a
                new subprocessor with a reasonable opportunity to object.
              </li>
              <li>
                <strong>Breach notice.</strong> Notify the Agent <strong>without undue delay and in any event within
                72 hours</strong> after confirming a security breach affecting the Agent&apos;s Client Data,
                with the information reasonably available, so the Agent can meet its own regulatory
                notification deadlines.
              </li>
              <li>
                <strong>Assist the Agent.</strong> Provide reasonable assistance with (a) responses to data-
                subject requests routed to the Agent, and (b) the Agent&apos;s own breach-notification,
                security-assessment, and regulatory obligations, taking into account the information
                available to R&amp;J Prime.
              </li>
              <li>
                <strong>Return/deletion.</strong> On termination, and on the Agent&apos;s request, delete or return
                Client Data within a reasonable period, except copies required by law or retained by
                subprocessors under their own schedules.
              </li>
              <li>
                <strong>Audit.</strong> Make available information reasonably necessary to demonstrate compliance
                with this DPA and, on reasonable notice and confidentiality terms, cooperate with a
                proportionate audit or provide a written security overview in lieu of on-site audit.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">5. Miscellaneous</h2>
            <p>
              This DPA is governed by the law and venue in the Terms. Liability under this DPA is
              subject to the limitations in the Terms. This DPA takes effect when the Agent accepts
              it or continues using the Service after it is offered.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">Schedule A &mdash; Subprocessors</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-slate-200 py-2 pr-4 text-left">Subprocessor</th>
                    <th className="border-b border-slate-200 py-2 pr-4 text-left">Purpose</th>
                    <th className="border-b border-slate-200 py-2 pr-4 text-left">Location</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Supabase, Inc.</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Database, authentication, file storage</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">AWS, United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Vercel, Inc.</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Application hosting/compute</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Stripe, Inc.</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Subscription billing (holds card data; PRIM does not)</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Resend (Plus Five Five, Inc.)</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Transactional and outreach email delivery</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Anthropic, PBC</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">AI extraction/organization of provided content</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">TextDrip</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Sync of the Agent&apos;s own contacts/message history into PRIM</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Ringy; Benepath; the Agent&apos;s website form provider</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Inbound lead intake the Agent routes to PRIM</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">United States</td>
                  </tr>
                  <tr>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Google/Apple/Mozilla push services</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Optional browser reminder notifications (no names)</td>
                    <td className="border-b border-slate-200 py-2 pr-4 text-left">Varies</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">Schedule B &mdash; Security measures (summary)</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Access &amp; isolation:</strong> database row-level security isolating each account&apos;s data;
                authentication required on all data endpoints; least-privilege staff access.
              </li>
              <li>
                <strong>Encryption:</strong> in transit (HTTPS/TLS); at rest via the storage provider.
              </li>
              <li>
                <strong>Application security:</strong> signature verification on payment/email webhooks;
                server-side handling of secret keys; security headers.
              </li>
              <li>
                <strong>Operational:</strong> logging/monitoring; a written incident-response plan with breach
                timelines; periodic dependency vulnerability review.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
