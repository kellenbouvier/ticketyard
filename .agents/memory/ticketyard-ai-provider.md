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

Waste Type is derived only after vendor parsing with deterministic name/category rules; unknown or unmatched vendors remain blank.

**Why:** The classification must be explainable and must not introduce another AI/provider dependency into the local OCR workflow.

**How to apply:** Keep classification downstream of `vendor` extraction and preserve the shared response, editable register field, and CSV column together when adding future deterministic categories.

Real ticket parsers need explicit layout branches when OCR emits table headings and fragmented header text; generic nearby-line fallbacks are unsafe.

**Why:** The Metro Green and Willow Oak layouts produced valid OCR but caused labels such as `Loads`, `Ticket Date`, `Line Total`, and `Qty/UOM/Rate` to be selected as values.

**How to apply:** Prefer vendor/layout signatures, validate candidate values, return blanks for uncertain fields, and keep real uploaded ticket fixtures in parser regression coverage.

Metro Green multi-ticket invoices are combined documents, not ticket batches: classify the invoice first and return one extraction with invoice metadata and accounting total.

**Why:** The invoice page lists many individual ticket numbers, but the downstream record must represent the single invoice and use the accounting-system total rather than line-item amounts.

**How to apply:** Use the invoice vendor/layout signature, focused OCR crops for small header/accounting regions, normalize known OCR variants, and leave ticket number/weight blank for the combined invoice row.