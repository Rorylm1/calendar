# Vercel deployment

The GitHub repository contains the frontend and the persistent Gmail service. Vercel builds only `web/`.

Production: [rory-calendar.vercel.app](https://rory-calendar.vercel.app/calendar). Repository: [Rorylm1/calendar](https://github.com/Rorylm1/calendar). The Vercel account was verified as `rorylm1` and the project belongs to `rorylm1s-projects`.

Deployment was verified on 7 September 2026: the production build passed, real Google sign-in completed, the existing Gmail connection and saved plans loaded, and anonymous or forged-header API requests returned 401. All 53 backend tests and 12 frontend auth/proxy tests passed. The Gmail reconnect callback now uses the Vercel origin, preserving the existing grant and backend owner identifier.

## Project settings

- Framework: Next.js
- Root Directory: `web`
- Node.js: 24.x
- Production branch: `main`
- Install/build commands: package defaults

Use the intended Vercel account and team when linking the repository. Production secrets belong only in the production environment; previews should not inherit access to the real calendar.

## Production environment

| Variable | Purpose |
| --- | --- |
| `CALENDAR_APP_ORIGIN` | Canonical HTTPS origin of the Vercel app |
| `CALENDAR_API_BASE_URL` | HTTPS origin of the existing Gmail service |
| `CALENDAR_SERVICE_TOKEN` | Service credential shared with that backend |
| `CALENDAR_OWNER_EMAIL` | Google account allowed to sign in |
| `CALENDAR_OWNER_ID` | Stable backend owner identifier; retain it when moving hosts |
| `AUTH_URL` | Same canonical origin as `CALENDAR_APP_ORIGIN` |
| `AUTH_SECRET` | Separate random secret for encrypted login sessions |
| `AUTH_GOOGLE_ID` | Google OAuth web client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth web client secret |

Do not expose these through `NEXT_PUBLIC_` variables. Gmail refresh tokens, the database encryption key and the OpenRouter key stay on the backend.

## Google callbacks

Add both exact URLs to the Google OAuth web client, replacing `https://your-calendar.vercel.app` with the production origin:

```text
https://your-calendar.vercel.app/api/auth/callback/google
https://your-calendar.vercel.app/api/calendar/gmail/callback
```

Application sign-in requests `openid email profile`; Gmail access remains a separate read-only connection. Keep existing redirects while migrating. Set the backend's `GOOGLE_REDIRECT_URI` to the production Gmail callback after it has been registered. This changes future connection callbacks without discarding the existing grant or stored data.

## Release checks

Build and test the frontend, then verify the production sign-in and the authenticated calendar state. Requests without a valid owner session must fail, including requests that imitate the old hosting provider's headers. A signed-in user must not be able to send calendar mutations from an unrelated origin.

The backend remains independently deployable. Routine frontend releases do not restart the worker or repeat the initial mailbox import.
