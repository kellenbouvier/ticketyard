# DHG Register / TicketYard — Final Report

Branch: `overhaul/audit-v1`. Date: 2026-08-07. See `AUDIT.md` for the full
Phase 1 findings this report resolves against, and `CHANGELOG.md`/
`PROGRESS.log` for the chronological detail.

## What was fixed

**H-3 — `pnpm install` was completely broken.** `pnpm-workspace.yaml` had a
half-finished edit (`allowBuilds:\n  esbuild: set this to true or false`) —
not valid config. Fixed to `allowBuilds: { esbuild: true }`, the real key
pnpm 11's `approve-builds` mechanism uses.

**H-1 — the documented root build command failed out of the box.**
`artifacts/ticket-yard/vite.config.ts` and `artifacts/mockup-sandbox/vite.config.ts`
unconditionally required `PORT`/`BASE_PATH` even for `vite build`, which
never binds a port. Fixed so those are only required for `vite dev`/`vite
preview`; `pnpm run build` now succeeds with zero environment setup.

**H-2 — the SPA and API server didn't actually talk to each other locally.**
Running them as two separate processes (exactly as `replit.md` documents)
meant every relative `/api/*` call from the Vite dev server returned the
SPA's own `index.html` instead of reaching the API — nothing outside
Replit's own router stitched the two origins together. Added a Vite dev
proxy (`/api` → `API_PROXY_TARGET`, default `http://127.0.0.1:8080`).

**C-1 — the OCR "deterministic parser" was fixture-hardcoded and
reproducibly returned wrong (non-blank) data.** The vendor-layout parsers
only accepted a value when it exactly equaled a specific literal captured
from one past OCR run. Re-running the exact same real ticket photo the
code was tuned on reproduced the identical wrong-vendor bug the owner had
already reported once (`vendor: "872"`, grabbed from a "Customer:" line;
`ticketNumber: "a"`), because (1) the Metro Green layout-detection regex
could mathematically never match a correctly spelled "Recycling", and (2)
the generic fallback treated "Customer" as a vendor-label synonym. Both
root causes are fixed, and every vendor-layout field extractor now anchors
on labels/shapes that generalize to any ticket from that vendor (a
uniquely-shaped ticket number, a number tagged "Tons", the accounting row
after an invoice's column header, a token repeated to disambiguate a job
number from an identically-shaped date) instead of a memorized literal.
Where no such anchor exists, the field is now honestly left blank — see
"Deliberate behavior changes" below.

**C-2 — ticket/invoice register rows were never persisted anywhere.**
Rows lived only in React state (`rowsByJobId`); a refresh silently wiped
every upload's OCR result and manual edits for every job, contradicting
both the owner's explicit written requirement and the exec summary's
"upload history"/"status tracking" asks. Added a `tickets` table (FK to
`jobs`, cascade delete), a `/jobs/:jobId/tickets` CRUD API, and rewired the
frontend to hydrate from and persist through it. Verified end-to-end: an
uploaded ticket's OCR result, a manual field edit, and a manually-added
row all survive a full "reload" (a fresh `GET /jobs/:jobId/tickets` from
scratch, no client-side cache) with a real cascade-delete cleanup.

**M-5 — no unique constraint on `(year, job number)`.** Added a DB unique
constraint plus a 409 response on both create and update, matching the
existing duplicate-year handling pattern.

## Deliberate behavior changes (not regressions)

- **`IMG_3279.jpeg`'s `date` field is now blank instead of
  `"07/02/2026"`.** The printed date is fragmented across separate OCR
  lines ("7/2", "0", ",") with no clean label next to it. The old code
  only produced a date by hardcoding acceptance of that exact fragment
  pattern for that exact ticket. Reconstructing a date from it generally
  would be guessing, which the product's own hard constraint explicitly
  forbids ("a blank field is much better than an incorrect value"). The
  regression test was updated to expect blank here, with a comment
  explaining why.
- **The invoice fixture's `purchaseOrder` now reads `"25-27458"` instead of
  the previously hardcoded `"25-21458"`.** That's what today's OCR pass of
  the accounting-row crop actually says; the old value was a literal typed
  into a regex from a different, unverifiable OCR run. There's no way to
  confirm which digit sequence is truly correct without re-reading the
  source image by eye, which is outside this session's tooling — the
  fix's job was to stop hardcoding an answer and instead read whatever the
  document's accounting row actually contains.

## Build / test results (final state)

```
pnpm run typecheck   → clean, all 8 packages
pnpm run build       → clean, all 8 packages (including mockup-sandbox, previously broken)
node artifacts/api-server/tests/ticket-parser-regression.mjs → 3/3 fixtures pass
```

Manual end-to-end verification (via direct HTTP calls matching the exact
API contract the generated frontend hooks use — see "UI verification
limitation" below):
- Year/job creation, listing, duplicate-rejection (409).
- Real ticket photo → local Tesseract OCR → deterministic field
  extraction → fields left blank where not confidently label-anchored
  (invoiceNumber/purchaseOrder/jobNumber correctly blank on a plain
  ticket) → persisted as a `Processed` row.
- Manual field edit → persisted, survives a fresh re-fetch.
- Manual (no-image) row → persisted with `Manual` status.
- Simulated reload (fresh `GET` with no client cache) → both rows return
  with all edits intact, in `Processed`/`Manual` status, exactly what a
  CSV export would emit for waste type, amounts, and status.
- Year deletion cascades through jobs and tickets cleanly (verified via
  direct DB row counts before/after).

No AI-provider keys, imports, or network calls were found anywhere in the
codebase (grepped for `openai`/`anthropic`/`claude`/API-key patterns
outside `node_modules`) — the hard "local & free OCR only" constraint is
intact.

## UI verification limitation

Per-instruction, UI/frontend changes should be exercised in a real
browser before calling them done. I attempted this: downloaded a
Playwright Chromium build (no root needed) and wrote a driver script that
walks the exact flow (create year → add job → open register → add manual
row → edit a field → **reload the page** → confirm the row survived →
export CSV → check console for errors). Chromium's headless binary
requires a full GTK/X11/NSS/ATK/dbus shared-library stack that isn't
present in this sandbox and can't be installed without root (`apt-get`
requires a password this session doesn't have); a partial attempt via the
project's own conda-forge toolchain only covered `libglib`, not the ~20
other missing libraries. I was not able to visually confirm the change in
an actual browser.

What I verified instead: the frontend's new code is typecheck-clean, the
production build succeeds, and every API call the frontend makes
(`useListTickets`, `useCreateTicketRecord`, `useUpdateTicketRecord`,
`useDeleteTicketRecord`) was exercised directly over HTTP with the exact
same request/response shapes the generated hooks use, including the
specific "does a fresh fetch after the fact still see the data" check
that is the actual regression this fix targets. I'm flagging this
explicitly rather than claiming a browser-verified UI, per instructions.
If a `/run`-style skill with browser deps preinstalled is available in
a follow-up session, running that same driver script (left at
`/tmp/verify.mjs` on this machine, not committed) would close this gap.

## Deferred (with reasons)

- **M-1 — externalize vendor→waste-type rules.** Still a hardcoded
  two-vendor allowlist. Deferred: it's technically correct and
  deterministic today; turning it into a config/DB-driven rule table is a
  contained follow-up that didn't block correctness or data safety, so it
  lost priority to C-1/C-2.
- **M-2 — true multi-row invoice support.** The exec summary asks for both
  "one invoice → many rows" and "summarize to one row where appropriate."
  Only the single-row summarized-invoice path exists. Deferred: building
  reliable multi-row detection needs more real multi-ticket invoice
  samples than the one fixture available here to avoid guessing row counts
  — getting this wrong (over- or under-splitting a real invoice) is a
  worse outcome than leaving it as consistent single-row behavior for now.
- **M-3 — HEIC upload support.** ImageMagick can already read HEIC, but the
  frontend/API contract only allow jpeg/png/webp/gif. Deferred: a
  contained, well-scoped follow-up (extend the media-type enum + orval
  regen) that didn't make the cut against the Critical items in the time
  available.
- **M-4 — no lint tooling.** Deferred: introducing an ESLint config from
  scratch is a scope decision (rule set, autofix policy) better made with
  the owner than assumed silently.
- **L-1 — no auth, open CORS.** Deliberately not "fixed" — see AUDIT.md;
  this needs an explicit decision from the owner about whether this
  internal tool needs a login at all, not code silently added on
  spec.
- **L-2 — archive vs. hard delete for jobs.** Left as hard delete (with
  confirmation) since it's a UX/product decision, not a bug.
- **Upload History / Export History nav items** remain visually present
  but non-interactive. The data they'd need now exists (the `tickets`
  table persists exactly this), but building dedicated cross-job
  history/export-log screens is new UI surface, not a bug fix, and was out
  of scope for this pass.
