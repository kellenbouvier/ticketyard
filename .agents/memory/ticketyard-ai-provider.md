---
name: TicketYard AI provider
description: Provider decision for TicketYard's image extraction flow.
---

TicketYard uses the user's `ANTHROPIC_API_KEY` on the server when the managed Anthropic AI integration is unavailable. The browser only calls the app's extraction route.

**Why:** The managed provider setup required an account upgrade that the user declined, while the brief explicitly requires Claude-based extraction and the environment supports secure secret storage.

**How to apply:** Keep the key out of frontend code and logs. If the provider path changes, preserve the server-side proxy boundary and strict JSON-only extraction contract.