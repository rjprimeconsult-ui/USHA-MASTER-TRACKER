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
