# Synthetic calendar evaluation

The corpus contains 50 invented messages: 41 should pass relevance triage and nine should be rejected. The first live run completed all 50 cases on 7 September 2026 for **$0.2470869** across 92 model calls. The unchanged strict baseline and mismatch review are recorded in [the baseline report](evaluation-baseline-2026-09-07.md). Offline checks separately validate the labels, scorer and spending controls using mocked responses. Neither establishes accuracy on real mail.

`server/evals/corpus.ts` contains the messages and labels. Every sender uses `example.test`; existing events and pending proposals are invented. Cases include restaurants, hotel stays, flights, train journeys, tickets, appointments and social plans, with acceptance, refusal, missing details, changes, cancellations and duplicates. Payment receipts are separated into past spending and receipts establishing a future reservation. A short image advert, mixed advertising/booking message and an embedded instruction test common filtering mistakes.

Each case records an explicit message timestamp and London reference zone. Relative dates must use the message or relevant thread timestamp, never the evaluation run date. `pass` allows either `relevant` or `uncertain`; it does not mean the owner is attending. Labels also specify proposal actions, attendance, known event fields and missing context. A refusal or unchanged booking can pass triage and correctly produce no proposal. Missing optional times remain null without requiring a redundant unresolved-time label, and the attendance field carries invitation/acceptance uncertainty. Titles and explanatory prose are not compared word for word. Curator labels and rationales are never sent to the model: message IDs are opaque, and subjects are ordinary category-level subjects shared across positive and negative cases.

From `server/`, run offline validation:

```sh
node --import tsx evals/run.ts
node --import tsx --test test/evaluation.test.ts
```

No model calls, service connections or calendar-database access occur without `--live`. A live run also requires `--budget-ledger` pointing explicitly at the existing usage ledger and model settings supplied in the environment. Use the calendar service’s current monthly budget and prices. The first run used this command shape:

```sh
node --env-file=/path/to/private-calendar.env --import tsx evals/run.ts \
  --live --budget-ledger=/path/to/calendar.sqlite --max-usd=0.50 \
  --output=evals/results/synthetic-evaluation.json
```

The runner reserves the smaller of $0.50, `--max-usd`, and the remaining configured monthly allowance before contacting OpenRouter. A raw SQLite connection reads and writes only the existing `usage` table; it does not instantiate the application Store against that database, run source recovery, read mail/events, or change calendar records. Reserving first prevents the normal worker from spending the same allowance concurrently. Synthetic sources, model caches and interpretation records stay in a fresh in-memory Store. The runner sends a synthetic owner address and ignores Gmail, WhatsApp, notification and calendar-service credentials.

The existing interpreter enforces per-request reservations and provider price limits. The runner stops on its first budget limit or error and does not retry. Unknown request outcomes retain conservative accounted cost; a process crash retains the outer reservation until manually reconciled. It stops starting calls if the UTC budget month changes. The report separates measured cost from uncertain reservations, and reports any anomalous provider charge honestly. Do not reuse an old remaining-budget estimate or settle a reservation without checking its request outcomes.

Results contain triage precision/recall, missed booking case IDs, extra proposals, mismatched labelled fields, required unresolved context, and cost. Proposal precision/recall require every labelled field of a matched proposal to be correct. Field accuracy helps distinguish one wrong detail from a completely missing event. Model prose is not judged. Cases not attempted because of cost or failure are excluded from measured quality; triage-complete cases can still be scored for triage when extraction stops early. `--limit=10` permits a smaller initial run; the default is all 50 in corpus order.

This is a starting regression set, not a representative statistical sample or a quality guarantee. Preserve the first raw baseline, review mismatches before changing prompts or labels, keep the receipt and ambiguity contrasts intact, and add new synthetic regressions for failures found in real usage without copying personal message content into the repository.
