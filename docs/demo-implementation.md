# Fictional interactive demo

Implemented 8 September 2026 using the existing Edge visual direction. `/demo` is a standalone, fictional, interactive example. Rory reviews the result before deciding when to share it. This record describes the implementation and the remaining acceptance work.

## Objective

Let someone understand the project in a minute: select a fictional message, see a proposed plan, review it, and place it on a beautiful month-first calendar. They can then edit or remove the plan, dismiss another suggestion, and reset the example. No account, mailbox, live model or personal calendar is required.

Keep the approved Edge visual direction: dark slate, restrained mint accents, fine calendar rules, a narrow rail and a dismissible day-detail panel. This is an interactive product example, not another design comparison screen.

## Implementation

The independent `/demo` route uses a small client controller driven by an in-memory reducer. Reuse existing `Button`, `Dialog`, `Input` and `Textarea` primitives, the layout's fonts, Edge classes in `globals.css`/`iterations.css`, and the presentation rules in `calendar/calendar.css`. Use type-only imports of `EventFields`, `CalendarEvent` and `Proposal` where useful; these contain no runtime integration code.

**Leave the personal calendar controller unchanged.** `calendar-client.tsx` combines rendering with API refreshes, Google connections, authentication, notification teardown and delivery settings. Mounting it with a `demo` flag would put the public experience near those effects. Copying the full component would also create a second large application to maintain.

Instead, implement a compact presentation-only `DemoMonth` using the existing grid and day-panel structure: event arrays, selected date, displayed month and callbacks enter as props. The approximately 150 lines of existing grid/day markup are a visual reference, not a reason to copy the surrounding controller. Reuse the established CSS directly. A later cleanup can extract a shared month component once both experiences are stable; that refactor is not a prerequisite for this demo.

Do not mount `/designs` either. It contains ten visual variants, browser-persisted feedback and a model-context tool. Its fictional examples are useful source material, but its controller is unrelated to the public walkthrough.

## Experience and fictional scenarios

Open on **September 2026**, with a small, deliberate set of fictional confirmed plans: dinner on the 8th, a train and a two-night stay from the 11th–13th, coffee on the 16th, a flight on the 22nd and a concert on the 26th. Use explicit supplied dates and zones. Label the view “Sample month”; offer “Back to September” instead of a misleading real-world “Today”.

The top bar keeps a visible **Fictional demo** label, **Try a message**, **Review** with a pending count, and **Reset demo**. The existing personal badge disappears on small screens, so the demo label needs its own responsive class and must remain visible. Replace personal connection/settings controls with demo actions; do not display a fake connected account or sync timestamp.

| Sample | What the visitor does | Visible result |
| --- | --- | --- |
| Restaurant confirmation | Select a sample email confirming a table for four at Juniper on 17 September at 19:30; choose “Create suggestion”. | Review shows the supplied date, time and source excerpt. “Add to calendar” selects the 17th and opens its day details. |
| Birthday invitation | Select a sample forwarded invitation for Alex's birthday on 19 September at 20:00. | Attendance remains unknown until the visitor chooses “I'm going”. A note explains that this only changes the demo calendar; no RSVP is sent. |
| Missing original date | Select “See you tomorrow at eight at Riverside”, with the original message date absent. | A suggestion explicitly requires a date. Confirm remains unavailable until a valid date is supplied; the demo does not infer “tomorrow” from today's date. |
| Promotional email | Select a dated travel offer with no personal booking. | An explanation says it is an offer, and no suggestion or calendar event is added. |

Keep these messages as selectable, read-only samples. The suggestions are predefined for each sample, and the interface should say **“Scripted examples — no accounts connected.”** Do not pretend to analyse arbitrary pasted text or simulate a live AI progress bar. Editing belongs in the suggestion and event forms, where its effect is clear.

Use the current review dialog styling. Show the source excerpt, attendance and any missing information; let the visitor edit the title, date, optional time, place and notes before confirming. Confirm closes review, selects the event date and announces the change. Clicking a calendar event opens its details with Edit and Remove. Dismiss removes a pending suggestion. Reset restores all fictional data and clears dialogs, edits, notices and scenario progress.

## Local state and isolation

Use deterministic fixture IDs and a pure reducer with actions such as `SELECT_SAMPLE`, `CREATE_SUGGESTION`, `CONFIRM`, `DISMISS`, `EDIT_EVENT`, `REMOVE_EVENT` and `RESET`. Creating the same sample twice must not duplicate it; show its existing suggestion or explain that it has already been handled. Reset allows another run. Keep view/month/dialog state local as well.

The demo may import UI primitives, pure date helpers, type definitions and its own fixtures. It must not import `CalendarClient`, `DeliverySettings`, `client-api`, `push-client`, authentication, server settings, backend clients or any live dataset. It makes no API, Google, Gmail, WhatsApp, model, feed or notification calls. Do not register a service worker, request permissions, use clipboard auto-reading, persist to local/session storage or IndexedDB, or send analytics. Refresh starts over.

The root layout currently loads fonts/styles without reading an account; `/calendar` performs its own owner check. `/demo/page.tsx` can therefore render without opening private services. Keep the demo wordmark pointed at `/demo`, and omit personal-calendar/sign-in links that might prefetch. The existing root-scoped notification worker has no fetch handler or private cache; the demo must not register, modify or unsubscribe it.

The production `/demo` response includes `connect-src 'none'; form-action 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'`. Hydration and assets work with this policy. This is defence in depth, not a substitute for a clean import graph and verified network behaviour. Do not change the personal route's policy or authentication.

## File ownership and sequence

| Owner | Files and responsibility |
| --- | --- |
| Demo implementation agent | New `web/app/demo/page.tsx`, `demo-client.tsx`, `demo-month.tsx`, `demo.css`; compose the isolated interface and responsive controls. |
| Same agent, or a coordinated reducer agent | New `web/app/demo/fixtures.ts`, `state.ts`, `dates.ts`, and `web/test/demo.test.ts`; fictional scenarios, deterministic transitions, validation and tests. Freeze their exported contract before parallel UI work. |
| Root | Optional `/demo` response-header change in `web/next.config.ts`, final browser verification, deployment preparation and documentation. |

No initial changes to `calendar-client.tsx`, live API routes, auth, backend, environment files or the research prototypes. No new runtime dependency is needed. Build fixtures/reducer first, then the demo components, then verify responsive and isolation behaviour. Prepare a reviewable preview; public sharing remains Rory's decision.

## Acceptance checks

- [ ] Restaurant message → suggestion → edit → confirm visibly adds exactly one event on the right date.
- [ ] Invitation remains provisional until explicit acceptance; missing-date confirmation is blocked; the offer creates no event.
- [ ] Dismiss, edit, remove and reset behave consistently; refresh restores the initial fixtures; repeated sample clicks do not duplicate records.
- [ ] Month navigation, day-detail close/reopen and event selection work at 390 px, 768 px and desktop widths, without horizontal overflow. The fictional label remains visible.
- [ ] Dialog focus, keyboard controls, Escape, form labels and save announcements work; reduced-motion preferences are respected.
- [ ] A signed-out browser opens `/demo` without an auth redirect. A signed-in owner sees exactly the same fictional fixtures.
- [ ] A network recording of every scenario shows only page/static assets: no `/api/calendar`, `/api/auth`, backend, Google, model or push calls. Stub forbidden requests to fail during browser verification.
- [ ] No personal data, feed URLs, subscriptions or credentials appear in initial HTML, assets or errors. Static import review finds none of the prohibited integration modules.
- [ ] No browser storage, notification permission or service-worker registration changes occur. Automated reducer tests and the existing web checks pass.
- [ ] The existing personal calendar still authenticates, renders and edits correctly. The finished preview and a short honest walkthrough are ready for Rory's review; publication is not claimed by this plan.

## Verification on 8 September

All 29 web tests and the production build pass. The demo tests cover exactly-once sample confirmation, explicit invitation acceptance, missing-date validation, advertising exclusion, editing, dismissal, removal, reset, calendar/date handling and the runtime import boundary. An independent review found and fixed hotel checkout clearing and focus restoration after deleting the event that opened a dialog. Hotel checkout stays editable and is required for the demonstration's stay fixtures.

Browser checks observed dinner sample → edited title → confirmation on the correct date; invitation acceptance; undated-forward confirmation blocked; dismissal; and advertising producing no suggestion. The layouts were checked at 390, 768 and 1440 pixels without horizontal overflow. Fictional-data disclosure stayed visible, and the browser reported no console warnings/errors during these flows. This is responsive browser testing, not physical iPhone acceptance.

The browser automation's native date-entry actions did not commit a changed date reliably. Missing-date completion and checkout correction are covered by reducer/rendered-form tests; native input/device acceptance remains open. A complete network recording was not captured; isolation evidence consists of the static import/capability test, unauthenticated page access, clean browser console and the enforced production connection policy. The private review UI was separately checked with an in-memory unmatched cancellation: it displays a clear notice and no confirmation/removal action.

## Short walkthrough

Open `/demo`, choose **Try a message**, then **A dinner booking**. Create the suggestion, edit its title if you wish, and add it to the month. Try the birthday invitation to see the explicit attendance decision, or the travel offer to see why an advert stays out. **Reset** restores the six original fictional plans. The examples are scripted and remain only in memory; they do not demonstrate a live WhatsApp connection or perform live model inference.

Final-build checks also verified hotel title editing, removal restoring keyboard focus to the persistent Try a message button, and Reset restoring the initial dataset. An unauthenticated HTTP request serves `/demo` with its restrictive connection policy, while the personal state API returns 401. Generated public assets were checked against the configured live web secrets and contained none of those values.
