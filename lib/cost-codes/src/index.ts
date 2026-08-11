/** D.H. Griffin job-cost accounting taxonomy (the "Cat" column on the real
 * "JC Entries by Job" report). This is the single source of truth for the
 * API, the DB write-path validation, and the web UI — DHG will add more
 * codes over time, so this stays a plain extensible array, never a rigid
 * enum baked into the database. */
export type CostCodeEntry = {
  section: string;
  code: string;
  name: string;
};

// Order here is the display order (grouped by section) shown throughout
// the app. To add a code: append an entry to the right section — no other
// change is required anywhere else in the codebase.
export const COST_CODES: CostCodeEntry[] = [
  { section: "Equipment-Internal", code: "03-180", name: "Pickup Truck" },
  { section: "Equipment-Internal", code: "03-219", name: "Mini Track Loader" },
  { section: "Equipment-Internal", code: "03-500", name: "Equipment-Internal-Other" },
  { section: "Equipment-External", code: "04-112", name: "Bobcat Class 2" },
  { section: "Equipment-External", code: "04-500", name: "Others" },
  { section: "Landfill", code: "05-110", name: "Landfill-External" },
  { section: "Materials", code: "06-100", name: "Supplies" },
  { section: "Materials", code: "06-110", name: "Small Tools" },
  { section: "Subcontracts", code: "07-115", name: "Other" },
  { section: "Per Diem", code: "08-100", name: "Per Diem" },
  { section: "Lodging/Travel", code: "09-135", name: "Motels" },
  { section: "Other-Job Cost", code: "12-100", name: "Other Job Cost" },
  { section: "Other-Job Cost", code: "12-110", name: "Industrial Hygienist" },
  { section: "Overhead", code: "20-001", name: "General Liability" },
];

const CODE_LOOKUP = new Map(COST_CODES.map((entry) => [entry.code, entry]));

export function costCodeByCode(code: string | null | undefined): CostCodeEntry | undefined {
  if (!code) return undefined;
  return CODE_LOOKUP.get(code);
}

/** null/undefined is always treated as valid — it means "needs review",
 * never a guess. Only a non-null value must match a known code. */
export function isKnownCostCode(code: string | null | undefined): boolean {
  if (code == null) return true;
  return CODE_LOOKUP.has(code);
}

export function isLandfillCostCode(code: string | null | undefined): boolean {
  return costCodeByCode(code)?.section === "Landfill";
}

export function formatCostCode(entry: CostCodeEntry | string | null | undefined): string {
  const resolved = typeof entry === "string" ? costCodeByCode(entry) : entry;
  if (!resolved) return "";
  return `${resolved.code} — ${resolved.name}`;
}

export type CostCodeSection = { section: string; codes: CostCodeEntry[] };

export function costCodesBySection(): CostCodeSection[] {
  const sections: CostCodeSection[] = [];
  const bySection = new Map<string, CostCodeEntry[]>();
  for (const entry of COST_CODES) {
    let codes = bySection.get(entry.section);
    if (!codes) {
      codes = [];
      bySection.set(entry.section, codes);
      sections.push({ section: entry.section, codes });
    }
    codes.push(entry);
  }
  return sections;
}

// ─── Conservative vendor/description auto-suggest ──────────────────────────
//
// Only ever fires on an unambiguous, well-known vendor/description match.
// Anything not covered here is left null ("needs review") rather than
// guessed — matching this codebase's classifyWasteCategory() convention.
// Keep this table small and obvious; add entries only for vendors that map
// to exactly one cost code with no reasonable ambiguity.
type SuggestionRule = { pattern: RegExp; code: string };

const VENDOR_RULES: SuggestionRule[] = [
  // Landfill / recycling disposal vendors -> Landfill-External
  { pattern: /metro\s+green/i, code: "05-110" },
  { pattern: /vulcan\s+materials/i, code: "05-110" },
  { pattern: /waste\s+management/i, code: "05-110" },
  { pattern: /willow\s+oak/i, code: "05-110" },
  { pattern: /sa\s+recycling/i, code: "05-110" },
  { pattern: /\bsims\b/i, code: "05-110" },
  // Hardware / auto-parts / small-tools suppliers -> Supplies
  { pattern: /home\s+depot/i, code: "06-100" },
  { pattern: /ace\s+hardware/i, code: "06-100" },
  { pattern: /o'?reilly/i, code: "06-100" },
  { pattern: /\bnapa\b/i, code: "06-100" },
  { pattern: /autozone/i, code: "06-100" },
  { pattern: /advance\s+auto/i, code: "06-100" },
  // Hotels/motels -> Motels
  { pattern: /comfort\s+inn/i, code: "09-135" },
];

const DESCRIPTION_RULES: SuggestionRule[] = [
  // Clearly-subcontractor invoices -> Subcontracts / Other
  { pattern: /subcontract/i, code: "07-115" },
];

/** Suggests a cost code from a ticket's vendor and/or description. Returns
 * null (never a guess) unless a rule confidently matches. This is only ever
 * a suggestion — the UI selector is always manually overridable. */
export function suggestCostCode(
  vendor: string | null | undefined,
  description?: string | null,
): string | null {
  const normalizedVendor = (vendor ?? "").replace(/\s+/g, " ").trim();
  const normalizedDescription = (description ?? "").replace(/\s+/g, " ").trim();

  if (normalizedVendor) {
    for (const rule of VENDOR_RULES) {
      if (rule.pattern.test(normalizedVendor)) return rule.code;
    }
  }

  for (const rule of DESCRIPTION_RULES) {
    if (normalizedVendor && rule.pattern.test(normalizedVendor)) return rule.code;
    if (normalizedDescription && rule.pattern.test(normalizedDescription)) return rule.code;
  }

  return null;
}
