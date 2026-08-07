# DHG Register

DHG Register turns construction-industry ticket photos into reviewable, export-ready records using local OCR.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env for the login gate: `APP_LOGIN_USER`, `APP_LOGIN_PASSWORD`,
  `SESSION_SECRET` — see `.env.example`. The API server fails fast at
  startup if any are missing (this does not block `vite build`/`pnpm run
  build`, which never execute server code).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ticket-yard` — the responsive DHG Register web workspace.
- `artifacts/api-server/src/routes/tickets.ts` — server-side Tesseract OCR and ticket field parser.
- `lib/api-spec/openapi.yaml` — source of truth for the ticket extraction contract.
- `artifacts/ticket-yard/src/index.css` — DHG Register visual theme and responsive layout.

## Architecture decisions

- Ticket images are converted to base64 in the browser and sent to the API; the server runs local Tesseract OCR and does not require a paid AI provider.
- Extraction returns only the defined ticket/invoice fields and blanks unreadable values instead of guessing.
- Ticket register rows are persisted server-side per job (`tickets` table) so upload history, statuses, and manual edits survive a refresh.
- The whole app sits behind a shared-credential login gate: a signed, httpOnly session cookie (see `artifacts/api-server/src/lib/session.ts`) gates every API route except `/healthz` and `/auth/*`, and the frontend redirects unauthenticated navigation to `/login`.

## Product

Users can upload or drag in multiple ticket images, review OCR-extracted vendor, ticket number, date, weight, amount, and description fields, correct values manually, retry failed reads, add manual rows, preview source images, see live totals, and export the register to CSV.

## User preferences

The user asked to preserve the existing modern construction/business-software direction rather than redesigning the product.

## Gotchas

- Keep extraction local and free; do not add a paid AI-provider requirement for the class demonstration.
- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
