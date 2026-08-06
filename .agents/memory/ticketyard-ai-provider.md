---
name: TicketYard AI provider
description: Provider decision for TicketYard's image extraction flow.
---

TicketYard uses local Tesseract OCR on the API server followed by deterministic parsing of labeled ticket fields. The browser only calls the app's extraction route, and no paid AI provider or API key is required.

**Why:** The user needed a working class demonstration without purchasing Anthropic credits. Tesseract is free, runs locally, and successfully reads the demo ticket while preserving the reviewable six-field contract.

**How to apply:** Keep extraction local and preserve the server-side route plus strict six-string-field contract. Extend the parser with label patterns before considering an external provider.

Local OCR preprocessing should treat the enhanced 2× image as the fast path and create 3× thermal/adaptive variants only when the primary OCR is weak. Tesseract candidate runs need bounded time and concurrency; otherwise high-resolution PSM combinations can stall uploads even when one candidate already has good text.

**Why:** The available ImageMagick/Tesseract runtime can be slow on large thermal variants, and deprecated ImageMagick options may be treated as command failures. Lazy fallback generation keeps normal ticket uploads responsive while preserving harder-photo recovery.

**How to apply:** Prefer supported ImageMagick operators such as `-statistic Median 3x3`, constrain local OCR worker resources, and log selected variant, PSM, rotation, confidence, and recognized-word counts for diagnosis.

Large source photos must be bounded before expensive ImageMagick filters, and the primary enhancement needs a simpler timeout retry rather than immediately failing the request.

**Why:** Real iPhone JPEGs can be many times larger than demo fixtures; preprocessing can hit the fixed timeout even though the underlying image format is valid.

**How to apply:** Resize the auto-oriented source to a roughly 2400px maximum dimension before enhancement, cap scaled variants as well, and retry timeout-killed primary preprocessing with a grayscale/contrast-only profile.