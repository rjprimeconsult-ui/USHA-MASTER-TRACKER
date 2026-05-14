# Prime Health Consultants — Benepath Outreach Emails

Three HTML email templates designed for cold-outreach to Benepath leads,
sent from Julio Fernandez's verified domain (`julio.fernandez@rjprimehealth.com`).

## Files

| File | Purpose | Subject |
|---|---|---|
| `email-1-initial.html` | First contact after Benepath inquiry | Health insurance quotes for you — Prime Health Consultants |
| `email-2-followup.html` | Follow-up if no response | Following up on your health coverage options |
| `email-3-final.html` | Final ask for DOB + gender to finalize quote | One more thing to finalize your quote |

## Banner image — REQUIRED before sending

The emails reference `https://www.primtracker.com/email-assets/phc-banner.png`.
Save the Prime Health Consultants banner image to that exact path:

```
public/email-assets/phc-banner.png
```

The image should be at least **600px wide** (1200px is better for retina
displays — email clients downsample). PNG or JPG. Keep file size under
200KB so it loads fast on mobile data.

Once committed and deployed to Vercel, the image is publicly hosted at
`https://www.primtracker.com/email-assets/phc-banner.png` and will load
inside the emails automatically.

## Preview locally

Open any of the `.html` files directly in your browser — they're
self-contained. The banner image will only load once you've added the
file to `public/email-assets/`.

## Preview on the deployed site

Once pushed to Vercel:
- https://www.primtracker.com/email-templates/email-1-initial.html
- https://www.primtracker.com/email-templates/email-2-followup.html
- https://www.primtracker.com/email-templates/email-3-final.html

## Brand palette (pulled from the banner)

| Token | Hex | Use |
|---|---|---|
| Deep navy | `#0A1733` | Banner backdrop, headings, signature name |
| Royal blue | `#2563EB` | CTA buttons, accent border, links |
| Soft blue tint | `#EFF6FF` | Status pill backgrounds |
| Border blue | `#BFDBFE` | Status pill borders |
| Body text | `#1E293B` | Main paragraph text |
| Muted text | `#64748B` | Footer + secondary text |
| Page wash | `#EEF2F7` | Email body background (outside the card) |
| Card | `#FFFFFF` | Main email content |
| Card subdued | `#F8FAFC` | Info boxes, footer band |
| Border | `#E2E8F0` | Section dividers |

## Personalization variables (when wired into PRIM)

These templates currently use hardcoded "Hello," / "Hi,". When wired into
PRIM's template system, swap in:

- `{customer_first_name}` — addresses by name when available, falls back gracefully
- `{agent_name}` — for the signature (currently hardcoded as Julio Fernandez)
- `{unsubscribe_url}` — replaces the placeholder in the footer with the
  per-recipient unsubscribe link from Resend

## CAN-SPAM compliance ✅

Each email includes:
- Identifiable sender (Prime Health Consultants in banner + signature)
- Honest subject line (no clickbait)
- Physical mailing address (Sunrise, FL)
- Unsubscribe link in footer
- Clear connection to the original inquiry ("you submitted a request for
  health insurance quotes online")

## Testing checklist before going live

1. Add `phc-banner.png` to `public/email-assets/`
2. Send yourself a test from PRIM's Sender Identity (Profile → Email sender)
3. Check rendering in: Gmail web, Gmail mobile, Outlook desktop, Apple Mail
4. Confirm the banner image loads (some clients block remote images by default —
   the alt text "Prime Health Consultants — Licensed Independent Insurance
   Agency" will show when blocked)
5. Click the CTA button → it should open the user's mail client with a
   pre-filled reply

## Next steps (queued)

- Wire all three into PRIM as send-able templates from the Prospect detail
  page (currently the Post-Sale Emails system is gated to Issued leads).
- Build the follow-up reminder widget — when Email 1 is sent to a Benepath
  prospect, an alert appears on the Prospects view and the main page
  reminding to send Email 2 in 2-3 days, Email 3 in 5-7 days.
