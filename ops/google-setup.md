# Gmail connection setup

Create a Google Cloud project for your own installation and enable the Gmail API. Configure an OAuth **Web application** client requesting only `https://www.googleapis.com/auth/gmail.readonly`. Project IDs, OAuth client identifiers and the authorized mailbox belong in private operator configuration, not this public guide.

## Redirects and application information

Configure the callback URL of the deployed frontend exactly:

- Production example: `https://calendar.example.com/api/calendar/gmail/callback`
- Local development: `http://localhost:3000/api/calendar/gmail/callback`

Set `GOOGLE_REDIRECT_URI` on the backend to the callback currently in use. Configure your actual homepage, privacy notice and authorized domains in Google Auth Platform. The information pages may be public; the calendar and its API must remain restricted to the configured owner. The frontend login identity and Gmail mailbox can be different, and both must be configured explicitly.

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GMAIL_ALLOWED_EMAIL` in the backend's private environment. This selects the original mailbox. Additional inboxes are explicitly requested in Connections; each OAuth state binds its requested email, and the callback verifies the actual Gmail profile before storing it separately. The original calendar sign-in allowlist is unchanged. It stores granted Google credentials encrypted in its database. Never publish credentials, OAuth codes, consent URLs, private account addresses or mailbox data.

## Consent and quota

Complete Google's consent screen directly as the account holder. An unverified personal-use application may show a warning; production status does not mean Google has verified the application or approved general public onboarding. Follow Google's [web-server OAuth guidance](https://developers.google.com/identity/protocols/oauth2/web-server) and [restricted-scope verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) when choosing testing or production status.

Check the quotas shown for your actual Cloud project. The backend paces reads, retries retryable quota responses and preserves its checkpoint through interruptions. Initial import batches can continue without triggering a new mailbox scan; regular checks remain hourly after the import completes. [Gmail quota documentation](https://developers.google.com/workspace/gmail/api/reference/quota) explains method-level costs.

## Verification

After connecting, verify the expected inbox state and inspect automatically added bookings/invitations and Needs details exceptions. Confirm that missing facts do not become invented events and that duplicate bookings received in two inboxes appear only once. Check useful bookings, adverts, ambiguous invitations, replies, duplicates, amendments and cancellations; account connection and synthetic tests do not establish broad interpretation accuracy.

Local credentials are stored in ignored `server/.env`; an optional deployment copy is `server/.env.production`. Restrict these files to their owner. The deployment helper uses `/etc/my-calendar/calendar.env` on the server. The frontend receives only its own backend service credential. Original installation details remain in ignored `ops/local/`.
