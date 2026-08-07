# Changelog

All notable changes to this project during the audit/overhaul are logged here.

## Unreleased

### Fixed
- `pnpm-workspace.yaml`: replaced an invalid, half-finished `allowBuilds` entry
  (`esbuild: set this to true or false`) with `allowBuilds: { esbuild: true }`.
  pnpm 11's build-approval mechanism reads `allowBuilds` (not the
  `onlyBuiltDependencies` list further up the file, which is a different,
  already-satisfied setting) — without this, every `pnpm install` failed with
  `ERR_PNPM_IGNORED_BUILDS` and the toolchain could not install esbuild's
  native binary, blocking all builds.
- `artifacts/ticket-yard/vite.config.ts` and `artifacts/mockup-sandbox/vite.config.ts`:
  `PORT`/`BASE_PATH` are now only required for `vite dev`/`vite preview`, not
  `vite build` (which never binds a port). Previously the documented root
  `pnpm run build` command failed outside Replit's own environment, which
  injects these vars automatically.
- `artifacts/ticket-yard/vite.config.ts`: added a dev-server proxy from
  `/api` to the API server (`API_PROXY_TARGET`, default
  `http://127.0.0.1:8080`). Previously running the SPA and API server as two
  separate local processes (as documented in replit.md) didn't work — every
  relative `/api/*` call from the Vite dev server returned the SPA's
  `index.html` instead of reaching the API.
- `artifacts/api-server/src/routes/tickets.ts`: rewrote the Metro Green /
  Willow Oak ticket and invoice field parsers to use genuine label/shape-
  anchored extraction instead of hardcoded literals copied from one past OCR
  run. Fixed the root-cause regex bug in `isMetroGreenLayout()` that could
  never match a correctly spelled "Recycling", and removed "Customer" as a
  vendor-label synonym in the generic fallback parser (it names the payer,
  not the vendor). See AUDIT.md C-1 for the full writeup.
- `lib/db/src/schema/jobs.ts` / `artifacts/api-server/src/routes/jobs.ts`:
  added a unique `(yearId, jobNumber)` constraint and a 409 response on
  create/update, matching the existing duplicate-year handling. Previously
  nothing stopped two jobs sharing a job number inside one year.

### Added
- `lib/db/src/schema/tickets.ts`: new `tickets` table (FK to `jobs`,
  cascade delete) persisting the ticket register — every extraction field,
  `status`, `error`, `fileName`, `createdAt`.
- `lib/api-spec/openapi.yaml` + regenerated `lib/api-zod` / `lib/api-client-react`:
  `/jobs/{jobId}/tickets` CRUD contract (list/create/update/delete) and
  `TicketRecord` schemas.
- `artifacts/api-server/src/routes/ticketRecords.ts`: CRUD handlers backed
  by the new table.
- `artifacts/ticket-yard/src/App.tsx`: the `Register` screen now hydrates
  from and persists through the ticket-records API instead of an
  in-memory `rowsByJobId` map, so upload history, OCR results, and manual
  edits survive a page refresh. See AUDIT.md C-2 for the full writeup.
- **App-wide login gate** (AUDIT.md L-1) — a single shared credential
  (`APP_LOGIN_USER`/`APP_LOGIN_PASSWORD`), not per-user accounts:
  - `artifacts/api-server/src/lib/authConfig.ts`: reads the credential and
    `SESSION_SECRET` lazily, failing fast with a clear error the first time
    they're actually needed (server startup) — never at build/bundle time.
  - `artifacts/api-server/src/lib/session.ts`: signed, httpOnly,
    `sameSite=lax` session cookie (`secure` in production), 7-day expiry.
    No server-side session store — stateless, verified via the
    cookie-parser signature plus an embedded issued-at timestamp.
  - `artifacts/api-server/src/routes/auth.ts`: `POST /auth/login`,
    `POST /auth/logout`, `GET /auth/me`. Login compares username and
    password unconditionally (SHA-256 + `timingSafeEqual`, no
    short-circuit) and returns an identical generic 401 for either a wrong
    username or wrong password, so neither response content nor timing can
    be used to enumerate valid usernames.
  - `artifacts/api-server/src/middlewares/requireAuth.ts` + `app.ts`:
    every `/api` route requires a valid session except `/healthz` and
    `/auth/*`.
  - `artifacts/ticket-yard/src/App.tsx`: `LoginPage` (matches the existing
    UI), `AuthGate` redirects unauthenticated navigation to an actual
    `/login` URL (via wouter's `<Redirect>`, not just an in-place
    component swap), `/login` itself redirects back to `/` if already
    authenticated, and "Log out" buttons are wired into both the home
    screen and the register sidebar.
  - `.env.example` added; `replit.md` documents the three new required env
    vars.
  - Credentials and the session secret are never logged anywhere in this
    codebase.

### Changed
- **Waste category is now a proper two-value field, not free text.** D.H.
  Griffin tracks disposal cost, hauling cost, billing, and profitability
  completely separately for C&D landfill vs. inert/concrete recycling, and
  the two must never be merged anywhere in the app.
  - `lib/db/src/schema/tickets.ts`: `wasteType` (free text) replaced with
    `wasteCategory`, a dedicated indexed Postgres enum column
    (`'C&D' | 'Inert'`), nullable to represent "needs manual review"
    (never a guessed value). Migrated via raw SQL: add the column,
    best-effort backfill existing rows to `Inert` only where the vendor
    confidently matches Metro Green or Vulcan Materials, drop the old
    column.
  - `artifacts/api-server/src/routes/tickets.ts`: `classifyWasteType()` ->
    `classifyWasteCategory()`. **Fixed a real bug**: the Vulcan Materials
    rule was mistyped as `/volk\s+and\s+materials/i`, a regex that could
    never match any real vendor name, so Vulcan tickets silently fell
    through to the default instead of being recognized. Metro Green and
    Vulcan Materials now both classify as `Inert`; everything else
    defaults to `C&D` (always one of the two — manually overridable in
    the UI, never a third blank state for a freshly-created ticket).
  - `lib/api-spec/openapi.yaml`: new `WasteCategory` enum schema;
    `wasteType` replaced with `wasteCategory` across `TicketExtraction`,
    `TicketRecord`, `CreateTicketRecordInput`, `UpdateTicketRecordInput`.
    Regenerated `api-zod`/`api-client-react`.
  - `artifacts/ticket-yard/src/App.tsx`: the free-text "Waste Type" input
    is now a dedicated two-option category selector. The single "Total
    Amount" stat card is now two independent cards — "C&D Landfill" and
    "Inert / Recycling" — each computed by filtering to that category
    first; the two are never summed. CSV export gained a "Waste Category"
    column (human-readable label) in place of the old "Waste Type" column.
  - New `artifacts/api-server/tests/waste-category-regression.mjs`: direct
    unit test of the classifier covering both categories, several Vulcan
    Materials spellings, and the empty-vendor default.
  - Also fixed, while touching the register table: `grid-template-columns`
    only defined 9 explicit tracks for what has actually been 12 rendered
    cells per row for a while (fields were added over time without
    updating it), silently wrapping each ticket row onto two grid rows.
