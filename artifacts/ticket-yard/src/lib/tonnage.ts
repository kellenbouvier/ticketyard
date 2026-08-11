/** Tolerant numeric-tonnage parser for the free-text `weight` OCR field
 * (e.g. "12.34 Tons", "1,234.5 tons" — see extractTonsWeight() in the API
 * server). Strips the unit word, thousands separators, and whitespace,
 * then requires what's left to be a clean number. Matches this codebase's
 * "never guess" rule for OCR fields: blank or unparseable input returns
 * null (never 0), so callers can exclude it from a sum instead of
 * silently counting it as zero tons. */
export function parseTonnage(weight: string | null | undefined): number | null {
  if (!weight) return null;
  const stripped = weight.replace(/tons?/gi, '').replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) return null;
  return Number.parseFloat(stripped);
}

/** Formats a tonnage value with 2 decimals, thousands separators, and a
 * "tons" unit label — e.g. 1234.5 -> "1,234.50 tons". */
export function formatTons(value: number): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tons`;
}
