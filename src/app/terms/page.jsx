'use client';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LEGAL, mailingAddressOrPlaceholder } from '@/lib/legalConfig.mjs';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 mb-8">
          <ArrowLeft size={14} /> Back to PRIM
        </Link>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-500 mb-8">Effective date: {LEGAL.effectiveDate}</p>

        <div className="prose prose-slate max-w-none space-y-6 text-slate-700">
          <p>
            These Terms of Service (&quot;Terms&quot;) are a legal agreement between you (&quot;you,&quot; the &quot;Agent&quot;)
            and <strong>{LEGAL.company}</strong> (&quot;R&amp;J Prime,&quot; &quot;we,&quot; &quot;us&quot;), a Florida limited
            liability company, governing your use of the PRIM application (&quot;PRIM,&quot; the &quot;Service&quot;).
            <strong> By creating an account or using PRIM, you agree to these Terms and to our Privacy
            Policy.</strong> If you do not agree, do not use PRIM.
          </p>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">1. What PRIM is (and isn&apos;t)</h2>
            <p>
              PRIM is a productivity tool for licensed insurance agents to store and organize leads,
              prospects, clients, commissions, and books, and to send emails you choose to send. PRIM
              is <strong>not</strong> an insurer, a broker, a lead vendor, a dialer, or a provider of legal, tax,
              or compliance advice. We do not guarantee any business result, uptime, or that
              calculations are correct for your tax or regulatory filings &mdash; <strong>you are responsible for
              verifying your own numbers and filings.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">2. Eligibility and your account</h2>
            <p>
              You must be at least 18 and a licensed insurance professional (or authorized staff)
              using PRIM for legitimate business purposes. Keep your password confidential; you are
              responsible for all activity under your account. Notify us promptly at <a href={`mailto:${LEGAL.contactEmail}`} className="text-indigo-600 hover:underline">{LEGAL.contactEmail}</a> if you suspect unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">3. Your data, and our respective roles</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>You own the data you put into PRIM.</strong> You grant us a limited, non-exclusive license
                to host, process, and display it solely to provide the Service to you.
              </li>
              <li>
                <strong>You are the controller / responsible party for your prospects&apos; and clients&apos;
                information; we are your service provider (processor).</strong> We process that information
                only on your behalf and per your instructions and these Terms. Our handling of it is
                described in the Privacy Policy and, where applicable, the Data Processing Addendum
                (&quot;DPA&quot;), which is incorporated into these Terms.
              </li>
              <li>
                <strong>You represent and warrant</strong> that you have the necessary rights, notices, and
                consents to collect the information you enter or import into PRIM and to have us
                process it, and that your use of that information complies with applicable law.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">4. Your outreach: consent and communications compliance</h2>
            <p>
              PRIM lets you send emails and organize contact activity. <strong>You are solely responsible
              for the legality of your outreach.</strong> In particular, you represent, warrant, and agree
              that:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Email (CAN-SPAM).</strong> For any commercial or promotional email you send through PRIM,
                you will use accurate sender and subject information, will not email recipients who
                have opted out, and acknowledge that PRIM includes a physical mailing address and an
                unsubscribe mechanism in such emails on your behalf, which you will not remove or
                circumvent.
              </li>
              <li>
                <strong>Calls and texts (TCPA / state &quot;mini-TCPA&quot; laws, including Florida&apos;s FTSA).</strong> PRIM
                <strong> does not</strong> send text messages or place calls. If you use separate tools (such as
                TextDrip or Ringy) and sync that activity into PRIM, <strong>you</strong> are solely responsible
                for obtaining any legally required prior express (or prior express written) consent,
                honoring do-not-call and opt-out (&quot;STOP&quot;) requests, observing calling-time and
                frequency limits, and otherwise complying with the TCPA and any applicable state law.
              </li>
              <li>
                <strong>General.</strong> You will comply with all laws and regulations applicable to your
                business, including insurance licensing and advertising rules and privacy/data
                security laws in the states where you and your contacts are located.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">5. Prohibited health information (no PHI / no clinical data)</h2>
            <p>
              <strong>PRIM is not a HIPAA-compliant platform and is not a HIPAA covered entity or business
              associate.</strong> You agree <strong>not</strong> to enter, upload, or transmit Protected Health
              Information or clinical records into PRIM, including but not limited to:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Specific medication names (e.g., &quot;Metformin&quot;);</li>
              <li>Specific diagnoses (e.g., &quot;Type 2 Diabetes&quot;);</li>
              <li>
                Lab results, treatment details, doctor names, or records obtained from a health plan
                or provider you service under a Business Associate Agreement.
              </li>
            </ul>
            <p>
              For prospect/client notes, use <strong>general impressions only</strong> (e.g., &quot;has health
              concerns,&quot; &quot;wants better coverage&quot;). You represent that any information you upload
              (including images processed by our AI import feature) is marketing/lead data and not
              PHI. <strong>We do not enter into Business Associate Agreements.</strong> We may remove, and are not
              liable for, any content you submit in violation of this section, and you are solely
              responsible for such content.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">6. AI features</h2>
            <p>
              PRIM uses a third-party AI provider (Anthropic) to extract and organize data from
              content you provide (e.g., statements, screenshots, imports, and assistant chats), as
              described in the Privacy Policy. You are responsible for reviewing AI-generated output
              before relying on it; <strong>AI extraction may contain errors &mdash; verify it.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">7. Subscriptions, billing, and trials</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                Paid plans are billed through <strong>Stripe</strong>; by subscribing you authorize recurring
                charges to your payment method until you cancel. <strong>Card data is handled by Stripe; we
                do not store your full card number.</strong>
              </li>
              <li>Free trials (if offered) convert to paid unless canceled before the trial ends.</li>
              <li>
                You can cancel anytime; cancellation stops future charges and takes effect at the end
                of the current billing period. <strong>Except where required by law, fees are
                non-refundable.</strong>
              </li>
              <li>We may change pricing prospectively with notice.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">8. Acceptable use</h2>
            <p>
              You agree not to: (a) reverse-engineer, hack, disrupt, or probe the Service or its
              security; (b) upload illegal content, malware, or another party&apos;s data without
              authority; (c) use PRIM to send unlawful, deceptive, or unconsented communications; (d)
              resell or share access to your account; or (e) use PRIM to violate any law or third
              party&apos;s rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">9. Intellectual property</h2>
            <p>
              The Service, including its software, design, and content (excluding your data), is
              owned by R&amp;J Prime and its licensors and is protected by law. We grant you a limited,
              revocable, non-transferable license to use PRIM per these Terms. You retain ownership
              of your data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">10. Service availability and disclaimers</h2>
            <p>
              The Service is provided <strong>&quot;AS IS&quot; and &quot;AS AVAILABLE,&quot; without warranties of any kind</strong>,
              express or implied, including merchantability, fitness for a particular purpose, and
              non-infringement. We do not warrant that the Service will be uninterrupted, error-free,
              or that outputs (including calculations) are accurate for your purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">11. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, R&amp;J Prime will not be liable for indirect,
              incidental, special, consequential, or punitive damages, or for lost profits, data, or
              business. <strong>Our total liability for any claim arising out of or relating to PRIM is
              limited to the greater of the fees you paid us in the 12 months before the claim or
              $50 (USD).</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">12. Indemnification</h2>
            <p>
              You agree to defend, indemnify, and hold harmless R&amp;J Prime from any claims, damages,
              liabilities, and costs (including reasonable attorneys&apos; fees) arising out of or related
              to: (a) your data or your collection, use, or sourcing of it; (b) your outreach or
              communications (including TCPA/FTSA/CAN-SPAM and consent obligations); (c) your
              violation of these Terms or any law; or (d) any PHI or prohibited content you submit.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">13. Termination</h2>
            <p>
              You may close your account anytime by emailing <a href={`mailto:${LEGAL.contactEmail}`} className="text-indigo-600 hover:underline">{LEGAL.contactEmail}</a>. We may suspend or
              terminate accounts that violate these Terms or the law, or to protect the Service. On
              termination, your license to use PRIM ends; data handling on termination is described
              in the Privacy Policy / DPA.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">14. Changes to these Terms</h2>
            <p>
              We may update these Terms as PRIM evolves. We will post the updated version with a new
              effective date and, for material changes, provide notice in the app or by email. Your
              continued use after the effective date constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">15. Governing law and disputes</h2>
            <p>
              These Terms are governed by the laws of the State of Florida, without regard to its
              conflict-of-laws rules. Any dispute will be resolved exclusively in the state or
              federal courts located in Florida, and you consent to their jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-6 mb-3">16. Contact</h2>
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
