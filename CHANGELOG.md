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
