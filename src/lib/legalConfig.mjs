// Single source of truth for company/legal identity used by the Privacy Policy,
// Terms of Service, DPA pages, and the CAN-SPAM footer on outbound email.
//
// IMPORTANT — mailingAddress: CAN-SPAM requires a valid physical postal address in
// commercial email. Until this is set to a REAL address (a P.O. box or the LLC's
// registered-agent address is acceptable), the outreach-email footer will show a
// clearly-marked placeholder and is NOT yet compliant. Set it in ONE place here.
export const LEGAL = {
  company: 'R&J Prime Consultancy LLC',
  companyShort: 'R&J Prime',
  attn: 'Juan Trejo',
  mailingAddress: '', // TODO(Juan): REQUIRED — set a real physical mailing address
  contactEmail: 'rjprimeconsult@gmail.com',
  effectiveDate: 'July 18, 2026',
};

// Renders the mailing address, or a visible placeholder if not yet set.
export function mailingAddressOrPlaceholder() {
  return LEGAL.mailingAddress && LEGAL.mailingAddress.trim()
    ? LEGAL.mailingAddress
    : '[mailing address — to be added]';
}

// Sentinel the outreach HTML builder emits in place of the unsubscribe URL.
// The outreach email is rendered client-side (which can't mint a signed token
// — the HMAC secret is server-only), so the send route string-replaces this
// sentinel with the real per-recipient signed unsubscribe link before sending.
export const OUTREACH_UNSUBSCRIBE_PLACEHOLDER = '%%PRIM_UNSUBSCRIBE_URL%%';

// CAN-SPAM footer row for commercial email. Returns a table `<tr>` (email
// layouts are table-based) carrying the sender-of-record company, a valid
// physical postal address, and a working unsubscribe link. Inline styles only —
// email clients strip <style> blocks. `unsubscribeUrl` is the per-recipient
// signed opt-out URL built by the send route; when absent we fall back to a
// mailto so the block is never left without an opt-out path.
export function canSpamFooterHtml({ unsubscribeUrl } = {}) {
  const addr = mailingAddressOrPlaceholder();
  const unsub = unsubscribeUrl
    ? `<a href="${unsubscribeUrl}" style="color:#64748B; text-decoration:underline;">Unsubscribe</a>`
    : `<a href="mailto:${LEGAL.contactEmail}?subject=unsubscribe" style="color:#64748B; text-decoration:underline;">Unsubscribe</a>`;
  return `
        <tr>
          <td style="background:#F8FAFC; padding:18px 36px 22px 36px; color:#64748B; font-size:11px; line-height:1.6; text-align:center; border-top:1px solid #E2E8F0;">
            <strong style="color:#0F172A; font-size:12px;">${LEGAL.company}</strong><br/>
            ${addr}<br/><br/>
            ${unsub} &middot; or email <a href="mailto:${LEGAL.contactEmail}" style="color:#64748B; text-decoration:underline;">${LEGAL.contactEmail}</a>
          </td>
        </tr>`;
}

// Standalone wrapper around the footer row, for contexts that aren't already
// inside the email's main <table> (e.g. the legacy plain-text post-sale wrap,
// or defensively appending to caller-supplied HTML).
export function canSpamFooterStandaloneHtml({ unsubscribeUrl } = {}) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px; margin:0 auto;">${canSpamFooterHtml({ unsubscribeUrl })}</table>`;
}
