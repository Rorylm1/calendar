# Calendar frontend

Conventional Next.js app for the selected Edge calendar. The existing `research/designs` project is preserved separately. This app serves the personal calendar at `/calendar`, redirects `/` there, and retains all ten fictional studies at `/designs`. `/privacy` describes the personal data flow without account or infrastructure details.

## Local development

Use Node 24, run `npm ci`, copy `.env.example` to `.env.local`, and supply the server-only settings. Run `npm run dev`; `npm run build` and `npm start` build and serve the production app. The build succeeds without credentials, and an unconfigured app keeps personal routes closed while showing a setup message on its sign-in page.

| Setting | Purpose |
| --- | --- |
| `CALENDAR_OWNER_EMAIL` | The one verified Google email allowed to sign in. |
| `CALENDAR_OWNER_ID` | The existing backend owner ID. Preserve it when moving hosts. |
| `CALENDAR_API_BASE_URL` | The backend HTTPS origin; localhost HTTP is allowed for development. |
| `CALENDAR_SERVICE_TOKEN` | Existing private backend credential. Never expose it to client code. |
| `CALENDAR_APP_ORIGIN` | Exact public frontend origin, such as `https://your-calendar.example`. |
| `AUTH_URL` | Must match `CALENDAR_APP_ORIGIN`; pins Auth.js URLs to the configured host. |
| `AUTH_SECRET` | A separate random session-encryption secret, at least32 characters. |
| `AUTH_GOOGLE_ID` | Google OAuth web client ID. |
| `AUTH_GOOGLE_SECRET` | Its private client secret. |

No `NEXT_PUBLIC_*` credentials are used. Keep real environment files out of Git. Vercel's project root should be `web`, with the Next.js framework preset and Node24. The backend and its hourly worker remain separate services; the frontend does not run mailbox scans itself.

## Google callbacks and access

Add `${CALENDAR_APP_ORIGIN}/api/auth/callback/google` to the Google client's authorized redirect URIs for sign-in. This login requests only `openid email profile`, with Auth.js-managed state, PKCE, nonce, CSRF protection, and encrypted JWT sessions. Access requires Google's `email_verified` claim and an exact owner-email match. Existing hosting-provider identity headers have no authority.

Gmail is a separate connection: its redirect is `${CALENDAR_APP_ORIGIN}/api/calendar/gmail/callback`, also configured in the backend's `GOOGLE_REDIRECT_URI`. The frontend binds that callback to its authenticated owner and a short-lived, HttpOnly, SameSite=Lax state cookie; the backend separately validates and consumes state. Confirmed calendar data keeps its original backend owner ID. Signing out ends the browser session; disconnecting Gmail is a separate action.

Every calendar API route independently checks the session. Mutations require the exact configured `Origin`, and only explicit API routes are proxied. The proxy supplies its own server token, discards caller-supplied authentication headers, disables caching, and does not follow backend redirects.

## Validation

`npm test` runs12 focused tests using invented identities, library-generated encrypted sessions, and a mocked backend. They cover owner verification, JWT tampering, forged hosting headers, cross-site writes, proxy credentials, fixed ownership, state-cookie validation, route/input limits, and sign-in parameter restrictions. `npm run typecheck` checks the complete frontend.

A local production smoke check verified root/calendar redirects, the sign-in/studies/privacy pages, anonymous API rejection, pinned Auth.js callback URLs, and a generated Google identity authorization URL with state/PKCE/nonce. It used synthetic credentials and did not complete Google consent, access Gmail, or call a model. Browser-based visual inspection and real Vercel sign-in remain deployment checks.

Versions were checked against npm and official docs on7 September2026: Next16.3.4, React19.2.8, and `next-auth`5.0.0-beta.32. The latter is the pinned integration currently recommended by [Auth.js installation docs](https://authjs.dev/getting-started/installation); it remains a beta release. See [Google provider setup](https://authjs.dev/getting-started/providers/google) and [Next.js16 guidance](https://nextjs.org/docs/app/guides/upgrading/version-16). A production-dependency audit reported no known vulnerabilities at the time of this build.
