# TicketYard

TicketYard turns construction-industry ticket photos into reviewable, export-ready records.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ticket-yard` — the responsive TicketYard web workspace.
- `artifacts/api-server/src/routes/tickets.ts` — server-side Claude image extraction route.
- `lib/api-spec/openapi.yaml` — source of truth for the ticket extraction contract.
- `artifacts/ticket-yard/src/index.css` — TicketYard visual theme and responsive layout.

## Architecture decisions

- Ticket images are converted to base64 in the browser and sent to the API; the Anthropic credential never reaches the client.
- Extraction returns only six string fields and blanks unreadable values instead of guessing.
- The first demo keeps the register local to the browser so review, correction, retry, and CSV export stay immediate.

## Product

Users can upload or drag in multiple ticket images, review AI-extracted vendor, ticket number, date, weight, amount, and description fields, correct values manually, retry failed reads, add manual rows, preview source images, see live totals, and export the register to CSV.

## User preferences

The user asked to preserve the existing modern construction/business-software direction rather than redesigning the product.

## Gotchas

- Keep `ANTHROPIC_API_KEY` server-side and never expose it through browser code.
- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
