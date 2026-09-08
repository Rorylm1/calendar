# Personal calendar — design exploration

Status: Edge selected as the working direction, 7 September 2026. Rory: “Edge is good, let’s stick with that for the while.” The ten studies remain available as references; this is a provisional direction that can evolve through real use. This is a working conversation document, not a locked design system. Rory supplies direction and feedback; Codex now leads the design exploration as well as the engineering. The earlier Claude Code ownership in the milestones is superseded for this exploration.

## Current decision — Edge

Use **J — Edge** for the functional personal calendar. Keep its full-width month, dark slate surfaces, restrained mint accents, slim navigation, and dismissible selected-day details. On mobile, details sit below the month. The calendar stays the primary surface; connection status and missing-detail actions should remain easy to reach without crowding it.

Current interaction decision, 8 September 2026: Gmail adds valid bookings and invitations automatically. Use the same Edge colour treatment for both; invitation titles have exactly one `INVITATION: ` prefix. Only missing or conflicting facts go to Needs details. The single Apple Calendar subscription uses the same prefix. Carry the Edge treatment into connection, processing, empty, and error states. Preserve the existing fictional design studies separately from real personal data. This choice does not freeze every spacing or typography detail.

## Objective

Make a personal calendar that feels exceptionally clear, modern, and enjoyable to use. It should be easy to see what is happening, distinguish an invitation from a confirmed plan, change attendance without sending an RSVP, and find the useful details of a booking.

The emotional payoff is simple: the scattered message has become a plan I can rely on. The interface should express that through clarity and a satisfying interaction, with enough personality to feel like a thoughtfully made independent app.

## References and what we are taking from them

Rory clarified that the intended documents are the Chess coach documents, and that they are references for **how to approach design**, not visual references to copy:

- `distinctive_design.md`: separate exploration from implementation, give each direction a clear identity, and compare small disposable prototypes before committing.
- `DESIGN.md`: turn the chosen idea into a usable specification covering typography, semantic colours, surfaces, motion, the main interaction, accessibility, and things to avoid.
- Installed `frontend-design skill`: ground choices in the subject, spend visual boldness in one place, and critique whether the result could belong to any unrelated product.
- `Sites design guidance`: put the actual activity in the first screen and make content, hierarchy, and interactions specific to the product.

The useful sequence is: establish a direction, explore alternatives, critique them, refine a prototype, and document the decisions. The chess aesthetic and iFlight's boarding-pass styling are not part of the calendar brief.

The distinctive-design research is being used for its design process, not as verification of its historical statistics or software recommendations. We do not need more plugins to begin this exploration.

## What is established, and what is open

**Established:** clean, modern, delightful; **quiet evening mood with dark slate, sharp detail, and restrained light accents**; **the month visible first so Rory can see how the weeks are filling up**; personal use; mobile first with a useful desktop layout; automatic plans and labelled invitations from messages; social plans and all dated bookings; details that remain honest about missing information.

**Open:** the strength of calendar grid lines, how much event detail fits inside the month, typography, surface depth, placement of the selected day's details, and the signature interaction. Names below label experiments; they are not proposed product names.

The month-plus-agenda structure fits this preference. A dark interface updates the earlier plan's bright-surface assumption. No new product functionality is implied by that visual change.

## Design thesis to test

**Let the shape of someone's week give the interface its character.**

Dates, times, places, and the relationship between plans provide enough material for a distinctive calendar. A restaurant reservation, an overnight journey, and a hotel stay should feel related while showing their particular useful details.

The working direction is **Quiet evening**. Keep the full month easy to scan, with the selected day's plans close at hand. Character should come from the proportions of the calendar, carefully drawn type, and continuity between a captured plan and its place in the month.

## Round 1 — five original mockups

Historical design exploration: the studies retain the original review-first interactions for comparison. They do not define the current automatic-entry policy.

Open `/designs` in the deployed app. Switch between A–E, use the phone preview, and collect feedback in Notes.

Rory requested five built alternatives before choosing a direction. The earlier two-concept preference is superseded. Dark and month-first remain the starting brief; none of the five is the final design.

The comparison app is retained in [web/app/designs/page.tsx](web/app/designs/page.tsx). The original local Sites checkout remains outside the public repository. Each study uses the same fictional bookings and shares date selection, month navigation, booking details, review actions, manual event creation, a phone preview, and a feedback notebook.

| Study | Composition | Type | Main accent |
| --- | --- | --- | --- |
| A — Contour | Precise navy grid, slim navigation rail, attached day panel | Manrope | Ice blue |
| B — Margin | Open month, expressive dates, horizontal day agenda | Newsreader + Manrope | Silver blue |
| C — Gather | Centred month with tactile date shapes and a lower detail surface | Gabarito + Manrope | Periwinkle |
| D — Field | Compact full-width calendar with aligned times and a detail dock | IBM Plex Sans + Mono | Muted mint |
| E — Ember | Warm charcoal week bands and a generous selected-day agenda | Hanken Grotesk | Soft amber |

Use the A–E tabs to compare them, try a busy date such as 19 September, and open Review. Shortlisting a direction does not commit the project to it. Notes are saved in the current browser and can be copied into this conversation.

## Round 2 — Field and Contour, refined

Historical comparison round, completed before Edge was selected. Its sample review flow is preserved; the personal app now adds valid items automatically.

Rory's feedback: **Field is the favourite; Contour also appeals.** The next five prototypes stay close to those families and aim for a very clean, modern customer experience. This is a second comparison round, not a final selection.

Open `/designs#air` in the deployed app to review the five new iterations. The **Originals / Round 2** switch keeps all ten available. Notes and shortlists remain separate for each direction.

| Study | Starting point | What it explores |
| --- | --- | --- |
| F — Air | Field | More space, softer calendar rules, and a generous agenda below the month |
| G — Focus | Field | The mint palette and quiet typography with a compact day sidebar |
| H — Flow | Field | A full month beside an agenda for the selected week |
| I — Slate | Contour | Crisp geometry with simpler top navigation and an attached day panel |
| J — Edge | Contour | A full-width month with day details that can be dismissed and reopened |

The useful comparison is how much context should stay visible: the selected day, the full week, or the widest possible month. All five retain the same sample plans and review flow. On narrow layouts, detail panels move below the calendar.

For feedback, compare the spacing and density of Air against Field, whether Focus or Slate makes the day easier to read, whether Flow's week view helps you plan, and whether Edge's dismissible details earn their space. Product names, typography, and the final composition remain open.

### Earlier palette and type ideas — reference only

**Exploration palette:** night `#151D27`, raised slate `#202C39`, text `#F0F4F8`, secondary text `#A9B6C5`, ice `#9CCBEE`, divider `#354558`.

Ice is for selection, focus, and primary actions. Most content remains neutral. Attendance and warnings need explicit language and their own semantic treatment; they must not be inferred from a decorative dot colour.

**Candidate type:** Sora for the month heading and date numerals, Source Sans 3 for event titles, controls, and descriptions. Test the actual numeral shapes, weights, and spacing in the prototype. Use tabular numerals for times; avoid an all-uppercase or monospace-heavy interface.

The palette and type are starting proposals, not validated specifications. Check contrast, focus, and legibility in rendered prototypes. Dark slate should look intentional through the surface hierarchy; it does not need glows, a star field, or a background texture.

### Month layout to discuss

On desktop, let the month occupy most of the screen, with a narrower panel for the selected date. On mobile, keep the whole month visible before the selected day's details. The grid should retain enough room to communicate occupancy; shrinking it to a decorative date picker would miss Rory's reason for choosing a month view.

**Information sketch — not a styled mockup:**

```text
September 2026          < Today >     +
Mon    Tue    Wed    Thu    Fri    Sat    Sun
       1      2      3      4      5      6
7     [8]     9      10     11     12     13
      Dinner               Train
                           [ Hotel stay  ]
14     15     16     17     18     19     20
21     22     23     24     25     26     27
28     29     30

Tuesday 8 September
19:30  Dinner at Luca
       2 people · London

Calendar        Needs details 3      Settings
```

- **Today and selected day are different states.** Show today's date with a quiet marker and the selected date with a stronger outline or fill. Neither should resemble an unread notification.
- **Attendance should be explicit.** Show all dated plans together. Prefix each invitation title exactly once with `INVITATION: `; confirmed titles stay unprefixed. Use the same event colour, with no per-invitation, sender or category palette. Invitations do not imply busy time.
- **A stay is a span; a dinner is an event.** Give multi-day bookings a compact connected treatment. The day detail explains check-in/out boundaries so a span does not imply an invented time.
- **Crowded days need a deliberate limit.** Show the first readable entries plus a clear additional-event count; the selected-day panel exposes the complete list.
- **Navigation stays obvious.** Previous/next month, Today, and Add event remain accessible without relying on gestures. Needs details stays reachable without occupying half the home screen.
- **Long journeys and date-only bookings remain understandable.** The detail panel carries origin/destination times and zones or “Time not supplied”; the month should not try to contain every booking field.

### Where the delight could come from

Selecting a day keeps the month stable and updates its details. After an automatic addition or a successful missing-detail correction, the event takes its place in the appropriate date, with a brief visual cue and clear feedback. The user should understand what changed without watching a long animation.

**Self-critique:** dark slate and a light accent are only a palette. The design succeeds if the month is readable, the selected day feels connected to its details, and understanding a captured plan or resolving a factual exception feels effortless. Add no decorative effects to compensate for unresolved hierarchy.

## The interaction that should make this feel special

Automatic entry is central to the product. The month should be useful without clearing an inbox; reserve Needs details for facts that cannot safely be filled in.

| Situation | What the interface should make clear | Useful action |
| --- | --- | --- |
| Restaurant confirmation | Added automatically with venue, date, time and source evidence | Edit details if needed |
| Party or webinar invitation | Already on the calendar with exactly one `INVITATION: ` prefix and the same event colour | I'm going / Remove; no RSVP is sent |
| Forwarded “tomorrow” | The original date is missing | Choose date |
| Safely matched train time change | The saved booking has updated automatically, preserving owner edits | Inspect or edit details |
| Safely matched reservation cancellation | The cancelled booking is removed automatically | No mandatory action |
| Conflicting amendment or unmatched cancellation | The missing match or conflicting facts are explicit in Needs details | Resolve the facts before applying |
| Hotel without check-in time | The dated stay is added automatically; time remains not supplied | Edit if useful |

Show the essential details immediately and let the source expand below. Avoid confidence percentages, “AI detected” badges, and a large chat transcript. Explain factual uncertainty in ordinary language, such as “Which Friday?” Attendance uncertainty is already represented by the invitation label; it does not require clearing an inbox.

Invitations and confirmed plans share one calendar, distinguished by exactly one `INVITATION: ` title prefix and the same event colours. A Needs details count is reserved for unresolved facts. Keep the underlying editable title unprefixed and make attendance changes reversible.

## Small sources of delight to explore

- **Continuity:** an entry expands into its details without making the user lose their place; closing returns to the same date and scroll position.
- **Useful restraint:** booking references copy with clear feedback; missing times stay visibly unknown; local travel times have understandable labels.
- **Calm completion:** adding a plan updates the calendar promptly after success. No confetti, ambient pulsing, or staged loading theatre.
- **Thoughtful empty states:** “No plans on Tuesday” plus Add event; a failed connection says what stopped and how to reconnect.

Motion should take roughly a fraction of a second and never delay an action. Use reduced-motion alternatives from the first prototype. Gestures can be explored later, but every action needs an obvious tap or keyboard route.

## Guardrails against a generic result

- The first screen must contain a useful calendar, with no introductory hero or slogan.
- Use one coherent signature, supported by deliberate type and spacing. A rare font or unusual colour cannot rescue a generic composition.
- Avoid nested cards, a grid of unrelated statistics, decorative gradients, frosted panels everywhere, and identical corner treatments on every element.
- Keep illustrations and photography out of the first comparison so they cannot disguise weak hierarchy. Venue imagery is a later option only if it improves recognition.
- Avoid false urgency, decorative unread dots, and category colours that resemble warnings. Dates, place, and status should remain readable without colour.
- Do not copy the chess document's font bans mechanically. Judge the rendered typography against this product; its role and execution matter more than novelty.
- Keep body text comfortable, essential labels readable, touch targets generous, visible keyboard focus, and contrast sufficient. A clean interface still needs clear controls.

## Historical exploration workflow

The sequence below records how the ten studies were compared before Edge was selected. Keep its fictional review interactions as process references, not current product requirements.

1. Use the confirmed mood and month-first layout as the brief. Record further reactions below.
2. Review Round 2 in `research/designs/`, comparing the five Field/Contour refinements with the originals using the same fictional month and review examples.
3. Compare the actual interface at an iPhone-sized viewport and a useful desktop size. Demonstrate selecting a date, opening an event, and confirming a fictional restaurant booking; real integrations stay outside this design comparison.
4. Choose the strongest layout and visual treatment, then refine one direction. Keep alternatives available for comparison rather than accumulating every idea in one design.
5. Turn this document into the chosen design system: named aesthetic, semantic tokens, typography, layout, components, motion, accessibility, and explicit decisions to preserve during implementation.

The shared fictional examples will include dinner on Tuesday 8 September 2026, a train and hotel stay beginning Friday 11 September, and a Saturday party invitation awaiting an attendance decision. Any additional times or durations in prototypes will be explicitly fictional. Every direction gets the same content, including an incomplete booking and a crowded day, so the comparison is fair.

## Conversation notes and open choices

| Topic | Current status |
| --- | --- |
| Reference documents | Chess coach documentation for process and structure only; not its visual design |
| Desired feel | Rory: “super clean and modern” and “delightful”; selected quiet evening, dark slate, sharp detail, restrained light accents |
| Design ownership | Codex explores and prototypes with Rory's guidance |
| Starting direction | Edge selected provisionally for the functional app; all ten studies retained |
| Light/warm/dark preference | Dark slate selected by Rory |
| Agenda/month/week as the home view | Month selected by Rory, to see how the weeks are filling up |
| Product name, final fonts, palette, and signature | Open |

Current implementation: automatic calendar entry, same-colour invitation labels, reversible attendance controls and Needs details are built and tested with fictional browser flows. Deployment of this update and the live existing-pending migration remain open. Next: verify the deployed experience, collect Rory’s design feedback and test the single subscription on the actual iPhone.
