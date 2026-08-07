# DHG Register / TicketYard — Audit

Branch: `overhaul/audit-v1`. Date: 2026-08-07.

## 1. Architecture overview

pnpm workspace, Node 24 / TypeScript 5.9, 9 packages:

| Package | Role |
|---|---|
| `artifacts/ticket-yard` | React 19 + Vite SPA — the shipped DHG Register UI. Talks to the API via relative `/api/*` calls (generated client, `baseUrl: "/api"`). |
| `artifacts/api-server` | Express 5 API. Routes: `/api/healthz`, `/api/tickets/extract` (local Tesseract OCR + deterministic field parser), `/api/years`, `/api/years/:id/jobs`. |
| `artifacts/mockup-sandbox` | Replit IDE design-preview scaffold (`kind = "design"` in its `artifact.toml`, served at `/__mockup`). Not part of the shipped product, unreferenced by ticket-yard/api-server. |
| `lib/db` | Drizzle ORM + Postgres. Schema currently has **only `years` and `jobs`** — no table for ticket/invoice rows. |
| `lib/api-spec` | `openapi.yaml`, source of truth for the API contract; Orval codegen. |
| `lib/api-zod` / `lib/api-client-react` | Generated Zod validators / React Query hooks from the OpenAPI spec. |
| `scripts` | Empty placeholder (`hello.ts`) + `post-merge.sh` (installs deps, pushes DB schema). |

OCR pipeline (`artifacts/api-server/src/routes/tickets.ts`): image → ImageMagick preprocessing (auto-orient, resize, grayscale/contrast/deskew variants) → Tesseract (multiple PSM modes, scored by recognized-word count/confidence) → best OCR text → regex-based field parser → deterministic waste-type classification by vendor name → JSON response. No shell interpolation (uses `execFile` with argument arrays throughout) — no command-injection risk found.

**Hard constraint check: no paid AI provider.** Confirmed — grepped the whole repo for `openai`/`anthropic`/`claude`/API-key patterns outside `node_modules`; nothing found. OCR is 100% local Tesseract + regex. This constraint is honored today.

## 2. Getting it running locally (as found vs. as fixed)

As documented in `replit.md`, running `pnpm --filter @workspace/api-server run dev` and separately starting the frontend does **not** work end-to-end outside Replit's own environment — see H-1 and H-2 below. Working steps after the Phase-2 fixes in this branch:

```bash
source .tyenv.sh                                  # local toolchain + DATABASE_URL
pnpm install                                       # now succeeds cleanly (see C-3)
pnpm --filter db run push                          # creates years/jobs tables
PORT=8080 pnpm --filter @workspace/api-server run dev     # API on :8080
PORT=24101 BASE_PATH=/ pnpm --filter @workspace/ticket-yard run dev  # SPA on :24101, proxies /api -> :8080
```

`pnpm run typecheck` and `pnpm run build` (whole workspace) both pass clean as of this audit's fixes.

## 3. Findings

### Critical

**C-1. The "deterministic parser" is hardcoded to specific fixture values, not genuinely generalizable — and reproducibly returns wrong (non-blank) data on the very tickets it was tuned against.**
`artifacts/api-server/src/routes/tickets.ts:626-729` (`parseMetroGreenFields`, `parseMetroGreenInvoiceFields`, `parseWillowOakFields`). These functions accept a value **only if it exactly equals one specific literal** observed in one past OCR run (`ticketCorrections["1382660"] = "1362560"`, `.find(c => c === "1362560")`, `/\b(25-?21458)\b/`, `/\b(26-25-1325)\b/`, `/\b(7\.86)\s+\$(118\.13)\b/`, etc.) — this is fixture-memorization dressed up as parsing, not a rule that reads any new ticket from these vendors.

Reproduced live in this session: re-running the exact real ticket photo the code was tuned on (`attached_assets/IMG_3279_1786045372175.jpeg`) through a freshly built server produces a **different, wrong, non-blank result**:
```
vendor: "872"        (expected "Metro Green Recycling, LLC")
ticketNumber: "a"     (expected "1362560")
description: "s: 6"   (expected "Concrete w/ Wire or Rebar")
```
This is the *identical* failure mode the owner already reported and asked to be fixed (`attached_assets/Pasted-The-previous-diagnostic-used-a-clean-test-fixture-and-d_1786045071046.txt`: *"Vendor: 872 ... Ticket Number: Loads"*). The earlier "fix" special-cased the one known-good transcript instead of fixing the general logic, so the same bug has now resurfaced on a merely slightly-different OCR pass of the same physical ticket.

Root cause, traced end to end:
1. `isMetroGreenLayout()` uses `/re[\s\W_]{0,8}yc/i` to detect "Recycling". This regex can **never match a correctly spelled "Recycling"** — the character between "re" and "yc" in that word is the letter "c" (`Re-c-yc-ling`), a word character, which the separator class `[\s\W_]` explicitly excludes. It only matches when OCR *corrupts* the spelling. On this run OCR actually spelled "Recycling" correctly, so the Metro Green layout was never detected and the ticket fell through to the generic fallback parser.
2. The generic fallback's vendor pattern (`tickets.ts:805`) treats `customer` as a synonym for `vendor`: `/^(?:vendor|company|hauler|supplier|facility|customer|from)\s*[:#-]?\s*(.*)$/i`. On this ticket layout, the line `Customer: 872` names the **receiving company's account number** (D.H. Griffin), not the hauler/vendor. The parser confidently returned it as the vendor.
3. This directly violates the explicit hard constraint (`attached_assets/Pasted-I-want-to-make-two-final-workflow-improvements-Please-p_1786108434322.txt`, section "NEVER GUESS OCR VALUES"): *"a blank field is much better than an incorrect value."* Here the code produced a confident, wrong, non-blank value.

**Fix plan:** rewrite Metro Green / Willow Oak layout detection to match on robust, whitespace/OCR-noise-normalized substrings instead of exact literals; remove `customer` from the generic vendor-label synonym list; replace every exact-literal-acceptance branch with genuine label-anchored parsing that generalizes to any ticket from that vendor, not just the archived demo photo; replace the regression tests' exact-value assertions with behavioral assertions (e.g. "a labeled field is extracted," "an unlabeled ambiguous token is never assigned to a field") so the suite can't be satisfied by re-hardcoding literals again.

**C-2. Ticket/invoice register rows are never persisted anywhere — not the database, not even `localStorage`.**
`artifacts/ticket-yard/src/App.tsx:1371` — `rowsByJobId` is plain in-memory React state. Refreshing the page, closing the tab, or the browser crashing loses every uploaded image, OCR result, and manual edit for every job. The DB schema (`lib/db/src/schema`) has only `years` and `jobs` tables — no table for ticket/invoice rows exists at all.

This directly contradicts the owner's own explicit written requirement (`attached_assets/Pasted-The-job-selector-needs-one-important-change-before-this_1786109152238.txt`, section 3 "PERSISTENCE" and section 4 "JOB RECORD ASSOCIATION"): *"Do not store this only in temporary React state... If server-side persistence is reasonably simple, prefer that, because this is intended as an ongoing internal application... Every ticket or invoice row must remain associated with the selected job."* It also silently defeats the executive summary's "upload history" and "status tracking" requirements — the sidebar's "Upload History" and "Export History" nav entries (`App.tsx:803-804`) are permanently inert decoration (`cursor-default`, never wired to a click handler), which is the tell that this was never finished.

**Fix plan:** add a `tickets` table (FK to `jobs`, all extraction fields + `status` + `fileName`), CRUD/list endpoints, and switch the frontend to load/save register rows through the API instead of ephemeral component state.

### High

**H-1. The documented root build command fails out of the box.**
`pnpm run build` (per `replit.md` and root `package.json`) fails: both `artifacts/ticket-yard/vite.config.ts:8-20` and `artifacts/mockup-sandbox/vite.config.ts:8-20` unconditionally `throw` if `PORT`/`BASE_PATH` aren't set in the environment — even for the `vite build` command, which never starts a dev/preview server and never uses `PORT`. Inside Replit these are injected by `artifact.toml`'s `[services.env]`; nothing supplies them for a plain local/CI build. Reproduced: `pnpm run build` at repo root fails on `artifacts/mockup-sandbox` with `PORT environment variable is required but was not provided.`
**Fix:** only validate/require `PORT`/`BASE_PATH` when Vite's `command` is `serve` (dev/preview); default `BASE_PATH` to `/` for `build`.

**H-2. Running the two services independently for local dev does not actually connect them.**
`artifacts/ticket-yard/vite.config.ts` has no dev-server proxy for `/api/*`, and the generated API client calls relative `/api/...` (`lib/api-spec/orval.config.ts: baseUrl: "/api"`). Reproduced: with the API server on `:8080` and the ticket-yard Vite dev server on `:24101` (both started exactly as `replit.md`'s "Run & Operate" section instructs), `curl http://127.0.0.1:24101/api/healthz` returns the SPA's `index.html` (200, `text/html`) instead of the JSON health payload — every API call from the app would silently fail the same way. This only works inside Replit's own environment because its router stitches both services under one origin (`.replit-artifact/artifact.toml`, `router = "path"`). A developer following the documented steps outside Replit cannot get the app working end-to-end.
**Fix:** add a Vite dev-server proxy from `/api` to the API server's local port (configurable via env var, default matching `.replit-artifact`'s `8080`).

**H-3. `pnpm-workspace.yaml` had a broken, half-finished edit that blocked `pnpm install` entirely.**
Found at the start of this session: `allowBuilds:\n  esbuild: set this to true or false` — not valid config (the literal string was left as a placeholder instead of `true`/`false`), and it postdated an already-correct `onlyBuiltDependencies: [..., esbuild, ...]` entry that turned out to be the *previous* pnpm-version's mechanism (pnpm 11's `approve-builds` actually reads/writes `allowBuilds`, not `onlyBuiltDependencies`). Left as-is, every `pnpm install` failed with `ERR_PNPM_IGNORED_BUILDS`, blocking the whole toolchain. **Fixed in this session** (see CHANGELOG.md) — `allowBuilds: { esbuild: true }`.

### Medium

**M-1. Waste-type classification is a hardcoded two-vendor allowlist, not a maintainable rule system.**
`classifyWasteType()` (`tickets.ts:609`) only recognizes "Metro Green" and "Volk and Materials" by exact substring, plus a generic landfill/transfer-station keyword catch-all. Technically deterministic (satisfies the "no AI" constraint) but every new vendor requires a code change + redeploy for a tool meant to run "for many years" per the owner's own framing. Recommend externalizing the vendor→wasteType map (config file or DB table) so it can be extended without a code change.

**M-2. No true multi-row invoice support.**
The executive summary explicitly calls for "one invoice can produce multiple rows; also support summarizing an invoice to ONE row where appropriate." Today `TicketExtraction` (openapi.yaml) is always a single object, and the frontend always creates exactly one row per uploaded image (`App.tsx: processFile`). Only the single-row "combined invoice" summarization path exists (Metro Green invoice case); the multi-row case was never built.

**M-3. HEIC (default iPhone photo format) is rejected client-side even though the OCR toolchain can read it.**
`getSupportedMediaType()` (`App.tsx:104`) only allows `image/jpeg|png|webp|gif`; a sample `.heic` file is even checked into `attached_assets/IMG_3288_1786039715421.heic`, suggesting this was anticipated. `magick -list format` confirms HEIC read/write support is installed. Field users photographing tickets with an unmodified iPhone camera will have uploads rejected with "isn't supported."

**M-4. No lint tooling exists anywhere in the workspace** (no `lint` script, no ESLint config). Not a regression, but worth flagging since code quality gates only cover typecheck/build today.

**M-5. `jobs` has no unique constraint on `(yearId, jobNumber)`** — nothing stops creating two jobs with the same job number inside one year (`lib/db/src/schema/jobs.ts`).

### Low

**L-1. No authentication/authorization anywhere, and `cors()` is wide open** (`artifacts/api-server/src/app.ts:28`, no options = any origin). For an internal tool proxied through Replit's own gateway this may be an accepted tradeoff, but there is no user/session concept at all — flagging as a conscious risk decision for the owner to confirm, not silently "fixing" by adding auth infrastructure that wasn't asked for.

**L-2. Job removal is a hard delete behind a plain `window.confirm`**, not the "archive" alternative the owner floated (`Pasted-The-job-selector-...txt`: *"a simple way to remove or archive a job"*). Low-priority UX nicety.

**L-3. `artifacts/mockup-sandbox`** is Replit IDE design-preview tooling (`kind = "design"`, served at `/__mockup`), fully unreferenced by the shipped product, yet sits inside the `artifacts/*` glob that `pnpm-workspace.yaml` sweeps into every `-r` command — it's what was breaking the root build (H-1). Recommend leaving it in place (it's Replit's own IDE tooling, not this app's call to delete) but fixing its Vite config the same way as H-1 so it stops breaking generic workspace commands.

## 4. Spec-vs-code conflicts requiring a judgment call

- **Ticket-row persistence:** exec summary + owner's own writeup ask for durable, job-associated records ("upload history," "status tracking," survives refresh). Code today has zero persistence. **Recommendation: implement server-side persistence (new `tickets` table)**, matching both the owner's explicit stated preference ("if server-side persistence is reasonably simple, prefer that") and the existing architecture (Postgres + Drizzle already used for years/jobs).
- **Multi-row vs. single-row invoices:** exec summary asks for both behaviors to coexist ("can produce multiple rows... also support summarizing to ONE row where appropriate"), which is inherently a judgment call per invoice layout. Recommend implementing multi-row extraction only where a table of distinct ticket numbers/amounts is confidently detected on the invoice; otherwise keep the existing single summarized-row behavior — never guess into the wrong row count.

## 5. Prioritized work plan for Phase 2

1. **P0 — correctness/hard-constraint fixes** (blocks everything else being trustworthy): C-1 (parser genuinely generalizes + regression tests rewritten), H-1, H-2, H-3 (H-3 already fixed).
2. **P1 — spec completion required by both the exec summary and the owner's own words**: C-2 (persist ticket rows server-side; wire Upload History).
3. **P2 — feature completion / robustness**: M-2 (multi-row invoices), M-3 (HEIC), M-1 (externalize vendor waste-type rules), M-5 (unique job constraint).
4. **P3 — defer, needs owner input or is low value relative to effort**: L-1 (auth — needs an explicit decision, not a silent addition), L-2 (archive vs delete), M-4 (lint tooling).
