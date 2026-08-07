---
name: Orval Zod v3 compatibility patch
description: After any orval codegen run, the generated api-zod file must be patched for Zod v3 compatibility before rebuilding the dist.
---

## Rule

After running `pnpm orval` (or any orval codegen), apply this patch before rebuilding lib/api-zod:

```bash
sed -i 's/zod\.int()/zod.number().int()/g' lib/api-zod/src/generated/api.ts
cd lib/api-zod && pnpm exec tsc -p tsconfig.json
```

**Why:** The workspace uses `zod: ^3.25.76` (Zod v3). Orval v8.23+ generates `zod.int()` for OpenAPI `type: integer` fields, which is Zod v4 syntax. Zod v3 does not have a top-level `z.int()` method — use `z.number().int()` instead. Without the patch, the api-server fails to start with `TypeError: (void 0) is not a function` at module load.

**How to apply:** Any time orval is run (either manually or if a build step triggers it), check whether api-zod/src/generated/api.ts contains `zod.int()` and apply the sed substitution. Then rebuild the lib/api-zod dist.

**Affected files:** `lib/api-zod/src/generated/api.ts` (generated, not hand-edited).
