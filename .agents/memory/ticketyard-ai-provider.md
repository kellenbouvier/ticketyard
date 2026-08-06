---
name: TicketYard AI provider
description: Provider decision for TicketYard's image extraction flow.
---

TicketYard uses local Tesseract OCR on the API server followed by deterministic parsing of labeled ticket fields. The browser only calls the app's extraction route, and no paid AI provider or API key is required.

**Why:** The user needed a working class demonstration without purchasing Anthropic credits. Tesseract is free, runs locally, and successfully reads the demo ticket while preserving the reviewable six-field contract.

**How to apply:** Keep extraction local and preserve the server-side route plus strict six-string-field contract. Extend the parser with label patterns before considering an external provider.