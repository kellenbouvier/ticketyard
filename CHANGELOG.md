# Changelog

All notable changes to this project during the audit/overhaul are logged here.

## Unreleased

### Added
- Full DHG cost-code taxonomy: `@workspace/cost-codes` now loads the COMPLETE
  DHG Standard Cost Code List (206 codes across all 15 groups, from
  `cost_codes.json`) instead of the 14-entry seed. Each `{code, description,
  group}` maps to the existing `{section, code, name}` shape (section = the
  group's human name, e.g. "Trucking/Hauling", "Landfill"). The helper API is
  unchanged (`costCodeByCode`, `isKnownCostCode`, `isLandfillCostCode`,
  `costCodesBySection`, `formatCostCode`, `suggestCostCode`); every downstream
  consumer (budget builder, cost-code filter/report, register selector,
  ticket validation) now offers the full list. Tests assert key codes,
  full group ordering, and a high total count rather than the old hardcoded 14.
- LEED Waste & Scrap Diversion tracking, decoupled from the waste C&D/Inert
  field and the budget module. A new shared package `@workspace/diversion`
  (`lib/diversion`) is the single source of truth: the seven-material taxonomy
  (`DIVERSION_MATERIALS`), `isKnownDiversionMaterial`/`isDivertedMaterial`, a
  conservative `suggestDiversionMaterial(vendor)` (never guesses — null when
  unsure), `computeDiversion` (per-material / diverted / residual tonnage and
  a NaN-safe % diverted), `groupDiversionByMonth` (ordered `MMM-YY` buckets),
  and a pure `buildLeedWorkbookModel` that emits one array-of-arrays sheet per
  month mirroring the DHG "Waste & Scrap Diversion" layout. Covered by
  `lib/diversion/tests/diversion.test.mjs`.
- Ticket schema gains a nullable, indexed `diversion_material` column (plain
  text, validated against the shared list at the API boundary — extensible
  without a migration). `diversionMaterial` added to the OpenAPI ticket
  schemas (extraction/record/create/update) and codegen; the API validates
  known-or-null (400 on unknown) and the OCR extraction path suggests a
  conservative default via `suggestDiversionMaterial`.
- Register UI: a Material selector column (independent of Cost Code and Waste
  Category), a Waste & Scrap Diversion summary panel (% diverted, total /
  diverted / residual tonnage, per-material tonnage), and an "Export LEED
  Report (.xlsx)" button that builds ONE workbook with a NEW TAB PER MONTH via
  SheetJS (`xlsx`). The existing CSV export is unchanged.
- In-page cost-code filter on the ticket register: a grouped-by-section
  "code — name" dropdown (plus "All" and "Needs review") that instantly
  narrows both the register rows and the Cost Code Totals panel to a single
  cost code without running a report or reloading. Pure client-side derived
  state (`src/lib/costCodeFilter.ts`), covered by
  `tests/cost-code-filter-regression.mjs`.

### Changed
- Waste category (C&D/Inert) is now optional and only meaningful for landfill
  / inert-landfill tickets. Removed the hardcoded `wasteCategory: 'C&D'`
  default (frontend `emptyExtraction` and the API `emptyFields`); the server
  classifier no longer falls back to C&D and returns `null` for any
  non-landfill vendor (assigning C&D/Inert only for landfill/disposal/inert
  vendors). In the register the Category column shows a neutral "N/A" (not a
  red "Needs review") for non-landfill tickets and never flags them as needing
  review; only landfill / inert-landfill tickets (detected via a 05-xxx cost
  code, an existing category, or a landfill/disposal/inert vendor) show the
  C&D vs Inert selector and a genuine "Needs review" when unset. Still fully
  user-overridable; the C&D/Inert stat cards, diversion feature, and existing
  categorized landfill tickets are unaffected. `TicketExtraction.wasteCategory`
  is now nullable in the OpenAPI spec (regenerated codegen).

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
- Flexible per-job **budgeting module**. One unified builder (no method_type /
  no "choose a method" step): per cost-code SECTION the user enters a lump sum,
  cost-code line items, or both (hybrid = coded lines + an optional
  "Additional [Section] (non-coded)" field). Subtotals, grand total, and
  remaining-vs-target are computed live, never stored.
  - `lib/budget` (`@workspace/budget`): shared pure `computeBudgetTotals(lines,
    target)` + `parseBudgetAmount` — the single source of truth reused by the
    API, the web UI, and unit tests (`lib/budget/tests/budget-totals.test.mjs`:
    lump/codes/hybrid/empty/over-under/blank).
  - `lib/db/src/schema/budgets.ts`: `job_budgets` (one per job, UNIQUE jobId,
    text `target_amount`) and `budget_lines` (section, nullable `cost_code`,
    label, text `amount`, `sort_order`; indexed on budgetId and
    (budgetId, section)). Nothing derived is persisted.
  - `lib/api-spec/openapi.yaml` + regenerated `lib/api-zod` /
    `lib/api-client-react`: `GET`/`PUT /jobs/{jobId}/budget`
    (`JobBudget`, `BudgetLine`, `PutBudgetInput`, `BudgetLineInput`).
  - `artifacts/api-server/src/routes/budgets.ts`: auth-gated GET (empty budget
    when none yet) and replace-all PUT upsert in a transaction; every non-null
    cost code validated against the shared taxonomy (400 on unknown).
  - `artifacts/ticket-yard/src/lib/budgetForm.ts` +
    `src/components/BudgetBuilder.tsx`: the unified builder (per-section
    collapse/lump vs. expand/cost-codes+additional, live Target/Current/
    Remaining bar, Expand-All template). Opens automatically after a job is
    created and from a "Budget" button on each job row and in the Register view.
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

### Added
- **Tonnage (weight) analysis.** Weight was already OCR-extracted per
  ticket (`extractTonsWeight()` in the API server, a free-text
  `weight` string like "12.34 Tons") but never totaled anywhere.
  - `artifacts/ticket-yard/src/lib/tonnage.ts`: new `parseTonnage()` —
    strips the unit word/commas/whitespace and parses the remainder as a
    float; returns `null` (never a guessed `0`) for blank or unparseable
    input, so it's excluded from sums entirely, matching this codebase's
    "never guess" rule for OCR fields. `formatTons()` formats a tonnage
    value with 2 decimals, a thousands separator, and a "tons" label.
  - `artifacts/ticket-yard/src/App.tsx`: the `totals` useMemo now also
    computes total net tons plus **independent** C&D tons and Inert tons
    (mirroring the existing never-blended `cdAmount`/`inertAmount`
    pattern — the two are never summed into one blended tonnage figure).
    Three new stat cards ("Total Tonnage", "C&D Tonnage", "Inert
    Tonnage") sit alongside the existing dollar cards; the existing "With
    Weight" card's detail now also surfaces the count of tickets missing
    a usable weight.
  - CSV export: kept the existing per-row Weight column and appended a
    trailing "Tonnage Summary" section listing Total Net Tons, C&D
    Landfill Tons, and Inert / Recycling Tons on separate rows.
  - New `artifacts/ticket-yard/tests/tonnage-regression.mjs` (run via
    `pnpm --filter @workspace/ticket-yard run test:tonnage`, following
    the existing tsx-based regression-test convention): covers
    "12.34 Tons", "1,234.5 tons", unit-suffix variants, and
    blank/garbage/wrong-unit input.
