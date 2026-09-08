# Fictional interactive demo

Updated 8 September 2026. `/demo` is an isolated, scripted example of the automatic-entry flow. It preserves the Edge layout and original design studies. Rory's design review and decision to share it remain open.

## Objective

Explain the product in a minute: a booking or dated invitation arrives and appears automatically in a month-first calendar. Invitations start with **INVITATION: **; only missing facts need input. Visitors can edit, change attendance, remove a plan, dismiss an incomplete item and reset the examples. No account, mailbox or live model is required.

## Experience

The calendar opens on September 2026 with six fictional plans: a dinner, train journey, two-night hotel stay, coffee, flight and concert. Dates, times and zones come from the fixtures. The heading says Sample month rather than Today. Fictional demo and Scripted examples / No accounts connected remain visible disclosures.

Choose **Try a message** and then **Try this message** to simulate arrival. This button runs a predefined scenario; it does not approve an event or analyse arbitrary text.

| Sample | Result |
| --- | --- |
| Dinner booking | A table at Juniper on 17 September at 19:30 appears immediately; its day opens without an approval form. |
| Birthday invitation | Alex's birthday on 19 September at 20:00 appears immediately as **INVITATION: Alex’s birthday**. **I’m going** removes the prefix; **Mark as invitation** restores it. Neither sends an RSVP. |
| Missing original date | A forwarded “tomorrow” without its original date waits in **Needs details**. Supply a real date to save it; unknown attendance defaults to Invitation and can be changed separately. |
| Travel promotion | The offer is excluded without creating an event or a Needs details item. |

Calendar event details offer Edit and Remove. Editable titles are unprefixed. Attendance changes keep the same event identifier and event-kind styling; there are no separate attendance colours. Repeated capture cannot duplicate a sample or restore an edited, dismissed or removed item. Reset restores the six original fixtures; refresh also starts over.

## Implementation and isolation

The demo has its own fixtures, pure reducer, date utilities and compact presentation components under `web/app/demo`. It reuses existing UI primitives and Edge styles. Calendar contracts are type-only imports; no personal controller or integration module is loaded. The reducer handles capture, completing factual details, attendance changes, edits, dismissals, removal and reset.

There are no live API, Gmail, WhatsApp, model, feed or notification calls, no account links or private data, and no persistent browser storage or service-worker registration. The demo does not mount `/calendar` or `/designs`. The original ten design studies and personal calendar remain separate.

The production demo response retains `connect-src 'none'; form-action 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'`. The static import/capability test checks every demo source file for prohibited integration imports and network/storage capabilities. These are safeguards, not a substitute for a complete browser network recording.

## Verification

The updated web suite has **49 passing tests**, plus TypeScript checks and a successful production build. Demo coverage includes:

- Automatic dated booking and invitation addition, exactly-once handling, and reversible attendance with stable identity.
- Missing and impossible dates blocked; supplying a date does not silently confirm attendance.
- Invitation prefix shown in month/day markup exactly once and absent from editable titles; the form retains invited attendance.
- Advertising exclusion, owner edits, dismissals/deletions, reset and independent fixtures.
- Time zones, ambiguous daylight-saving times, overnight journeys, hotel checkout validation and month layout.
- The runtime import and network/storage capability boundary.

The original demo's browser checks covered 390/768/1440 px layouts, focus restoration, hotel editing, deletion and reset. Those checks predate this automatic-entry update. On this update, computer-use verification was blocked because the Mac was locked; new end-to-end browser interactions, responsive presentation of the longer labels and native date entry remain unverified. No physical iPhone acceptance is claimed. A complete browser network recording also remains open.

## Short walkthrough

Open `/demo` → **Try a message** → **A dinner booking** → **Try this message**. The booking appears on the 17th automatically. Try the birthday sample and open its event to switch between invited and going. Try the missing-date example to see **Needs details**, or the travel offer to see filtering. **Reset** restores the initial six plans.

These examples are scripted and temporary. They do not demonstrate real WhatsApp delivery, live AI interpretation, a working iPhone subscription or push delivery.
