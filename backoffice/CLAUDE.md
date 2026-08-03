# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Nest (watch) + the Vite dev server, concurrently — one command
npm run dev:server   # Nest alone (the console then 502s until Vite is up)
npm run build        # vite build → client/dist, then nest build → dist/
npm start            # node dist/main (production mode: serves client/dist)
npm run typecheck    # tsc --noEmit for BOTH halves (server, then client/tsconfig.json)
npm run lint         # eslint --fix over src/**/*.ts
npm test             # jest; the only suite is opt-in (see Testing)
npm run db:generate  # drizzle-kit generate — SQLite (admin.schema.ts) ONLY
```

`npm run dev` serves everything on **one port** (`PORT`, 4300 on the host under
Compose). Vite's own port (5175) is deliberately never published — see *One
origin* below.

Prettier is enforced here (semicolons, single quotes), unlike `platform/`.
`npm run lint` on this tree is safe.

## Role

The **operator console** for `platform/`: read the game's rounds, bets and money
outbox, and perform the three operational actions the platform exposes — pause /
resume the round loop, force-crash the current round, retry money moves the
outbox gave up on. NestJS 11 + React 19 (react-admin 5) in **one process**.

Scope is the platform only (`crash_pilot`). White-label entities — players,
wallets, transactions, launch sessions — are **out of scope** by design, so a bet
shows a `user_id` UUID and nothing more human than that. Investigating a specific
player starts in the white-label.

## The two boundaries

Everything else here follows from these:

**1. Reads go straight to Postgres; every write goes through the platform's HTTP
admin API.** The platform owns the round loop, the bets and the `wallet_ops`
outbox. A write that went around it would be a state change no outbox row
remembers and no broadcast told anyone about. So there is no write path to
`crash_pilot` in this codebase at all — only `PlatformAdminClient`
(`src/modules/platform/platform-admin.client.ts`), the single holder of
`PLATFORM_API_URL` + `ADMIN_API_KEY`, which sends `x-admin-key` server-to-server.
The key never reaches the browser.

**2. That rule is enforced by the deployment, not by discipline.** At boot
`ensureReadonlyRole()` uses the superuser `POSTGRES_ADMIN_URL` **once** to create
(and re-sync the password of) a `LOGIN`-only role with `SELECT` on `public` plus
`ALTER DEFAULT PRIVILEGES` so tables the platform adds later are covered too. The
long-lived pool then logs in as *that* role. A bug, a stray Drizzle call or a
hand-typed `UPDATE` physically cannot modify the game's data.

## Architecture

**Boot order matters** (`src/main.ts`, all before `NestFactory` so a failure stops
the boot instead of surfacing as a broken screen):
`ensureReadonlyRole()` → `assertPlatformSchema()` → `connectPostgresReadonly()` →
`openSqlite()` → `migrateSqlite()` → `bootstrapAdmin()`.

**Two databases, one process:**

| | store | schema | migrations |
|---|---|---|---|
| Game data | the platform's Postgres (`crash_pilot`) | `src/drizzle/platform.schema.ts` — a **copy**, read-only | never, by anyone here |
| Console data | SQLite (`SQLITE_PATH`) | `src/drizzle/admin.schema.ts` — `users`, `audit_log` | `drizzle/migrations`, applied on boot |

`drizzle.config.ts` lists **only** `admin.schema.ts`, so `npm run db:generate`
physically cannot emit a migration for `crash_pilot`.

SQLite (not a second Postgres schema) because the data is tiny and
single-writer — and because the console must still let you log in and read the
audit log when the platform's database is the thing that is broken.

**Schema drift** — `platform.schema.ts` is kept byte-identical to
`platform/src/drizzle/schema.ts` so drift is a plain `diff`. Its `check`s and
`index`es are inert here; they are copied only to keep that diff clean.
`assertPlatformSchema()` compares column *names* against `information_schema` on
every boot and `process.exit(1)`s on any difference — including an **extra**
column, which a named-column `SELECT` would survive: an added column means the
platform's model moved, and a console showing a stale picture of the money domain
without saying so is worse than one that will not start. The fix is a copy edit.
`tests/platform-schema.smoke.spec.ts` is the deeper (per-column `SELECT`) check.

**Modules** (`src/modules/`) — one per resource, all under `/api`:

| Route | Role | Notes |
|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout` | `@Public()` | sets/clears the `bo_session` cookie |
| `GET /api/auth/me` | any | the session probe react-admin's `checkAuth` calls |
| `GET /api/dashboard` | viewer+ | engine state (via the platform) + stuck-work counters (via SQL) |
| `GET /api/rounds`, `/api/rounds/:id` | viewer+ | Postgres, read-only |
| `GET /api/bets`, `/api/bets/:id` | viewer+ | Postgres, read-only |
| `GET /api/wallet-ops`, `/api/wallet-ops/:id` | viewer+ | Postgres, read-only |
| `POST /api/wallet-ops/retry` | operator, admin | → platform `POST /api/admin/wallet-ops/retry` |
| `POST /api/engine/pause` | operator, admin | → platform `POST /api/admin/engine/pause` |
| `POST /api/engine/force-crash` | operator, admin | → platform `POST /api/admin/rounds/current/crash` |
| `GET /api/users` + CRUD | admin | SQLite |
| `GET /api/audit-log` | admin | SQLite |
| `GET /api/health` | `@Public()` | `/` belongs to the SPA, so health lives under `/api` |

**Three global guards, and their order is the access-control design**
(`app.module.ts`):

1. `AuditGuard` — authorizes nothing; attaches a response listener. **First**, so
   that requests the next two turn away are still recorded. A viewer trying to
   force-crash a round is exactly what an audit log is for, and as an interceptor
   (which is what it obviously is) it would be the one event missing, because Nest
   runs guards before interceptors.
2. `JwtCookieGuard` — deny by default; `@Public()` opts out.
3. `RolesGuard` — reads `@Roles()`; a route without one is viewer and up.

**Auth** — username + bcrypt (cost 12) → JWT in the **httpOnly** cookie
`bo_session`, `SameSite=Lax`, `Secure` in production, and deliberately with **no
`maxAge`**: the cookie dies with the browser session while the JWT carries the
real 8 h limit, so closing the tab ends the shift on a shared operator machine.
No token in JS, so no XSS-readable session; no CORS, because there is only one
origin. The role travels in the token, so a demotion takes effect on the next
login — acceptable at this scale, worth remembering when revoking access.

**Roles:**

| | viewer | operator | admin |
|---|---|---|---|
| Read every list + dashboard | ✅ | ✅ | ✅ |
| Retry wallet ops, force-crash, pause | — | ✅ | ✅ |
| User CRUD, audit log | — | — | ✅ |

`bootstrapAdmin()` creates `BACKOFFICE_ADMIN_USER` / `_PASSWORD` **only while the
users table is empty** — so changing those vars later does nothing, and a
password changed in the UI is never reverted by a restart. `UsersService` refuses
to demote or delete the **last admin**; that check plus the `users_role_valid`
CHECK constraint are what keep the console from locking everyone out.

## Client (`client/`)

React 19 + react-admin 5 (MUI). Vite `root: client`, build output `client/dist`.
`client/tsconfig.json` is separate from the server's — the shared root config
would apply Nest's decorator settings to JSX.

**One origin.** Nest serves the console in both modes (`src/startup/serve-client.ts`):
in development it proxies everything except `/api` to the Vite dev server
(`http-proxy-middleware`, `ws: true` for HMR); in production it serves
`client/dist` with `no-store` on `index.html`, `immutable` on fingerprinted
assets, and an SPA fallback that refuses `/api/*` and non-GET so a typo'd
endpoint stays a 404 instead of becoming 200-of-HTML. If Vite's port were
published, the SPA would sit on a different origin from the API and the session
cookie would need `SameSite=None; Secure` + CORS with credentials — a security
posture production never uses. So it isn't published, and `hmr.clientPort` is
`BACKOFFICE_PUBLIC_PORT` because the HMR client dials back to the port the
*browser* knows.

**react-admin wiring** (`client/src/`):

- `http.ts` — the envelope seam. Unwraps `{ data }` and turns
  `{ error: { message } }` into the `HttpError` message the operator sees, so a
  server refusal reads as "Username \"x\" is taken", not "Conflict".
- `dataProvider.ts` — `ra-data-simple-rest` for CRUD, plus four non-CRUD methods
  (`getDashboard`, `setEnginePaused`, `forceCrash`, `retryWalletOps`). Modelling
  those as fake resources would give react-admin an optimistic cache entry for a
  fact only the engine knows.
- `authProvider.ts` — `checkError` logs out on **401 only**; a 403 must stay on
  screen, or the message saying "you may not do this" is hidden behind a login
  form.
- `App.tsx` — `<Admin>` children-as-function of permissions; `users` and
  `audit-log` are simply absent for non-admins.

**Resource names are the API paths, hyphens and all** (`wallet-ops`,
`audit-log`): `ra-data-simple-rest` builds `${apiUrl}/${resource}`, so a
camelCase name would request `/api/walletOps` and 404. Menu labels come from
`options.label`.

**Server-side list contract** (`src/shared/ra/list-query.ts`) —
`?filter={json}&range=[start,end]&sort=["field","ORDER"]` +
`Content-Range: <resource> <start>-<end>/<total>`. Nothing about it is generic:
the sort field and every filter key are attacker-controlled strings that would
otherwise be spliced into SQL, so each resource declares exactly which columns
are sortable and how each filter maps to a condition. An unknown filter is a
**400, never a silent no-op** — a filter the server quietly drops shows a list
that is wrong in the one way the operator asked it not to be. Rows per request
are capped at 500, which is why every list sets `exporter={false}`.

Two client-side details that are load-bearing: date filters are normalised to an
absolute ISO instant in the browser (`IsoDateTimeInput`), because the container
runs UTC and a naive `2026-08-01T18:00` would ask about different three hours for
an operator in UTC+3; and every action is wrapped in `<Confirm>`, because a
crashed round cannot be un-crashed and a retried payout may already have moved
money.

## Audit log

`AuditGuard` records every `POST/PUT/PATCH/DELETE` under `/api` except
`/api/auth/*` (a login body is a password). The action name is **derived from the
route**, never from a decorator — an action you have to remember to annotate is
one that eventually is not audited: static segments after `/api` joined with dots,
and a single segment gets the verb appended (`users.create`, `engine.pause`,
`wallet-ops.retry`). Any key matching `/password|secret|token|key/i` is
`[redacted]` before the body is stored. The row is written from a `finish`/`close`
response listener, so the recorded status is the one the operator actually got —
403 from a guard, 409 forwarded from the platform, 500 from a bug.

`audit_log` has **no FK** to `users` and denormalizes `username`: the trail must
outlive the account, and it records who they were at the time.

**Who force-crashed a round lives here, not in the platform.** The platform
stores only the *fact* (`rounds.forced_at`), because that must survive in exports
that never see this service; the name is a console concern.

## Testing

One suite, opt-in, because everything else here needs a live stack:

```bash
docker compose up -d postgres
RUN_PG_SMOKE=1 npm test              # tests/platform-schema.smoke.spec.ts
```

It `SELECT`s every column of `rounds`, `bets` and `wallet_ops` as declared in
`platform.schema.ts` against the live database — the type-level check
`assertPlatformSchema()` skips. Read-only; it writes nothing.

Guards, routes and the UI are verified by hand (see `plan_backoffice.md` §10 —
accepted costs). Adding a route means checking its role gate yourself.

## Gotchas

- **Node 22 + ESM-only dep**: `http-proxy-middleware@4` is ESM-only and is loaded
  from CommonJS via `require(esm)`. Downgrading Node below 22.12 breaks the dev
  proxy.
- **`better-sqlite3` needs trixie, not bookworm** — its prebuilt linux-arm64
  binary is linked against GLIBC 2.38 (bookworm has 2.36), hence
  `node:22-trixie-slim` in the Dockerfile while the other services use the slim
  default.
- The dev proxy's `upgrade` listener is subscribed by the middleware itself on the
  first proxied request. Adding `server.on('upgrade', proxy.upgrade)` attaches a
  second listener and proxies every websocket twice.
- Postgres `numeric` arrives as a string and `count()` as a bigint-string; both
  are converted at the controller edge, never in the client.
- `GlobalExceptionFilter` maps every `HttpException` to
  `ErrorCode.VALIDATION_ERROR`, so a 404 from an unmatched route carries a
  misleading code. Cosmetic — react-admin branches on the status — but do not
  read anything into that field.
