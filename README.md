# My Calendar

A personal calendar that turns commitments and dated bookings from Gmail into plans you can review. The Edge interface keeps the month in focus, with quiet details for each day.

[Open the calendar](https://rory-calendar.vercel.app/calendar) · [Explore the design studies](https://rory-calendar.vercel.app/designs)

Bookings include flights, trains, restaurants, hotels, tickets and appointments. Ordinary purchase receipts and promotions do not count as commitments. Suggestions stay in Review until you accept them.

## Project layout

- `web/` — the Next.js frontend, private Google sign-in and server-side API proxy. Deploy this directory to Vercel.
- `server/` — the Gmail connection, hourly checks, interpretation and encrypted SQLite storage. This runs as a persistent service on a server.
- `ops/` — deployment instructions and service templates. Private machine configuration stays outside Git.
- `design.md`, `plan.md`, `milestone.md` — design decisions, product plan and implementation milestones.

The frontend preserves the earlier fictional design studies at `/designs`. The working calendar is at `/calendar`.

## Run locally

Use Node.js 24. Install dependencies separately in `server/` and `web/`, and copy each `.env.example` to `.env` before filling in your own settings.

```sh
npm --prefix server ci
npm --prefix web ci
npm --prefix server run dev
```

In another terminal:

```sh
npm --prefix web run dev
```

Google application sign-in uses identity scopes only. Connecting Gmail is a separate consent flow with read-only mailbox access. The configured owner is the only person who can open the calendar API.

## Deployment

Connect this repository to Vercel with **Root Directory `web`** and the **Next.js** preset. Configure the production environment described in [web/.env.example](web/.env.example) and [ops/vercel.md](ops/vercel.md).

The Gmail worker stays on its persistent server: moving a frontend deployment does not copy or reset the mailbox connection, pending suggestions or calendar database. Only the frontend's server-side proxy receives the backend service token; the browser does not.

Keep real `.env` files, API keys, OAuth secrets and database files out of Git. The example configuration contains placeholders only.

## Validation

```sh
npm --prefix server test
npm --prefix server run typecheck
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
```

Live interpretation checks are optional and use synthetic email examples. See [server/README.md](server/README.md) for their usage and cost controls.
