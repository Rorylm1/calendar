# First synthetic model baseline

All 50 fictional cases completed on 7 September 2026 at 22:29 UTC using Gemini 3.5 Flash Lite triage and Gemini 3.6 Flash extraction. The runner made 92 calls. Provider-reported and accounted cost both round to **$0.2470869**, within a $0.50 run reservation inside the existing monthly allowance. No personal messages or calendar records were used or changed.

## Unchanged raw result

| Measure | Result |
| --- | --- |
| Relevant cases passing triage | 41 / 41 |
| Irrelevant cases rejected | 8 / 9 |
| Triage precision / recall | 97.6% / 100% |
| Proposals expected / returned | 39 / 37 |
| Proposals correct on every labelled field | 29 |
| Strict proposal precision / recall | 78.4% / 74.4% |
| Labelled fields correct | 282 / 306 (92.2%) |
| Cases left unattempted | 0 |

These are small synthetic-set measurements, not real-mail accuracy or end-to-end application quality. The scorer compares raw interpretation output before the worker's validation, evidence checks and duplicate handling. A single differing label makes a whole proposal fail the strict score. The original result remains unchanged; no adjusted success percentage is presented.

## Mismatch review and resulting fixes

- **Time format: one appointment.** The model supplied `10:15:00` and `11:00:00`; the application previously required minute precision and would reject the captured message. The worker now normalizes valid zero seconds without losing information. Nonzero seconds and malformed clocks still fail validation. A synthetic worker regression verifies the resulting review item.
- **Unmatched cancellation: one appointment.** The model could not name an existing event. The worker previously failed the message; it now retains an evidence-backed incomplete notice, explicitly requiring a matching saved plan. It also handles unmatched amendments this way. No event target or revision is invented, confirmation remains blocked, and the interface offers review/dismissal without a misleading save/remove action.
- **Cancellation attendance: four matched bookings.** The model used declined or unknown attendance instead of the label's confirmed value. The correct cancellation action and target were present. Attendance does not control cancellation approval; regression tests verify that these proposals can remove the intended event after explicit confirmation. These are over-strict labels, not four failed cancellations.
- **Category: two social plans.** Drinks and a picnic were classified as food rather than social. Dates and times were correct. The current category names overlap, so this is taxonomy ambiguity. No longer prompt or post-hoc relabelling was introduced.
- **No dated event: two cases.** An open train ticket with no chosen journey date and a tentative undated social idea produced no proposal. The labels expected incomplete review items. Whether these belong in the calendar or a future ideas/tasks inbox is a product decision; the user's current scope emphasises dated commitments and bookings. The raw misses are retained without forcing vague ideas into Review.
- **Triage over-inclusion: one newsletter.** A clinic newsletter passed the first filter. Extraction produced no proposal, so the effect was an extra model call rather than a calendar suggestion.

The two processing fixes have targeted regression coverage, and the complete backend suite now passes 117 tests. No prompt, corpus label or model setting was changed following this run, and no additional paid evaluation was needed to reproduce the deterministic processing failures.

## Next evaluation work

Retain complete synthetic outputs and add a separate worker-level acceptance/evidence check in the next evaluator version. Resolve cancellation-attendance and food/social label policy before publishing a comparative benchmark; explicitly decide whether undated ideas belong in scope. Keep this first raw report as the baseline. Real use must still measure missed bookings, correction effort, capture delay and cost.

The full machine report is kept in ignored operator storage. Public source contains only fictional examples, aggregate measurements and these reviewed findings.
