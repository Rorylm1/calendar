# Private calendar frontend

The frontend keeps the fictional design studies at `/designs` and the functional personal calendar at `/calendar`. The public `web/` source can be deployed with the authentication and configuration described in its own README. The historical Sites checkout remains local in `research/designs` and is excluded from this repository.

The server-side API bridge forwards approved `/api/calendar/*` requests to the private backend using `CALENDAR_API_BASE_URL` and the secret `CALENDAR_SERVICE_TOKEN`. Configure the authenticated owner and exact application origin explicitly. A hosting provider's private audience setting is not a substitute for the bridge's owner checks.

Gmail refresh tokens, the database encryption key and the OpenRouter key remain on the backend. Google identity sign-in also needs the OAuth web client credentials in Vercel's server environment. The calendar service token and authentication secrets must never use browser-exposed environment variables. Keep real `.env` files and platform project metadata out of Git.

Verified checks for the original private deployment include owner/origin restrictions, manual create/edit/delete, optional-field clearing, stale-revision protection, Gmail connection status and the OAuth return. General browser visual QA, broad real-mail quality and iPhone delivery remain separate acceptance work. A new deployment must repeat the authentication and OAuth checks for its own origin.

The connection view explains model processing and links the privacy notice. It exposes last/next check, pending work, monthly interpretation spending and retry controls. Suggestions always require explicit review before entering the calendar.

The production frontend is now [rory-calendar.vercel.app](https://rory-calendar.vercel.app/calendar), deployed under `rorylm1s-projects` and connected to `Rorylm1/calendar` (`main`, root directory `web`). Real Google identity sign-in and access to the existing connected calendar were verified on 7 September 2026. Anonymous API calls and forged legacy hosting headers return 401. Existing plans and review suggestions were preserved.

Private account identifiers and original infrastructure history are preserved only in ignored `ops/local/`.
