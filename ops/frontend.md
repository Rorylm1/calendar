# Private calendar frontend

The frontend keeps the fictional design studies at `/designs` and the functional personal calendar at `/calendar`. The public `web/` source can be deployed with the authentication and configuration described in its own README. The historical Sites checkout remains local in `research/designs` and is excluded from this repository.

The server-side API bridge forwards approved `/api/calendar/*` requests to the private backend using `CALENDAR_API_BASE_URL` and the secret `CALENDAR_SERVICE_TOKEN`. Configure the authenticated owner and exact application origin explicitly. A hosting provider's private audience setting is not a substitute for the bridge's owner checks.

Google and OpenRouter credentials belong only to the backend. The calendar service token must never use a browser-exposed environment variable. Keep `.env` files and platform project metadata out of Git.

Verified checks for the original private deployment include owner/origin restrictions, manual create/edit/delete, optional-field clearing, stale-revision protection, Gmail connection status and the OAuth return. General browser visual QA, broad real-mail quality and iPhone delivery remain separate acceptance work. A new deployment must repeat the authentication and OAuth checks for its own origin.

The connection view explains model processing and links the privacy notice. It exposes last/next check, pending work, monthly interpretation spending and retry controls. Suggestions always require explicit review before entering the calendar.

Account identifiers, exact hosted URLs and original deployment history are preserved only in ignored `ops/local/`.
