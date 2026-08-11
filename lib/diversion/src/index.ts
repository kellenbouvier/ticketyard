/** LEED Waste & Scrap Diversion — the single source of truth for diversion
 * material classification and the monthly diversion math, shared by the API
 * (write-path validation + extraction suggestion), the web UI (Material
 * selector, Diversion summary panel, LEED .xlsx export) and the tests.
 *
 * This is DISTINCT from the waste category (C&D/Inert) field and from the
 * budget module — it must never be coupled to either. A diverted load is any
 * recyclable/scrap material (concrete, asphalt, metal, wood, paper/cardboard,
 * masonry/brick); "Residual/Trash" is a landfill/disposal load and is NOT
 * diverted. `null` means "needs manual review", never a guess. */

// ─── Material taxonomy ──────────────────────────────────────────────────────

// Display/column order — mirrors the reference DHG "Waste & Scrap Diversion"
// workbook layout. The first six are the diverted (recyclable/scrap)
// materials; "Residual/Trash" is the single non-diverted (landfill) bucket.
export const DIVERTED_MATERIALS = [
  "Concrete",
  "Asphalt",
  "Metal",
  "Wood",
  "Paper/Cardboard",
  "Masonry/Brick",
] as const;

export const RESIDUAL_MATERIAL = "Residual/Trash";

// The full ordered list of allowed values (diverted materials + residual).
export const DIVERSION_MATERIALS = [
  ...DIVERTED_MATERIALS,
  RESIDUAL_MATERIAL,
] as const;

export type DivertedMaterial = (typeof DIVERTED_MATERIALS)[number];
export type DiversionMaterial = (typeof DIVERSION_MATERIALS)[number];

const MATERIAL_SET = new Set<string>(DIVERSION_MATERIALS);
const DIVERTED_SET = new Set<string>(DIVERTED_MATERIALS);

/** null/undefined is always valid — it means "needs review", never a guess
 * (mirrors isKnownCostCode in @workspace/cost-codes). Only a non-null value
 * must be one of the known materials. Used at the API write boundary. */
export function isKnownDiversionMaterial(m: string | null | undefined): boolean {
  if (m == null) return true;
  return MATERIAL_SET.has(m);
}

/** A load counts as DIVERTED only for a recognized recyclable/scrap material.
 * null (needs review), "Residual/Trash", and any unknown value are NOT
 * diverted. */
export function isDivertedMaterial(m: string | null | undefined): boolean {
  if (m == null) return false;
  return DIVERTED_SET.has(m);
}

// ─── Tonnage parsing (same convention as @/lib/tonnage in the web app) ───────

/** Tolerant numeric-tonnage parser for the free-text `weight` OCR field
 * (e.g. "12.34 Tons", "1,234.5 tons"). Blank/unparseable input returns null
 * (never 0), so it is excluded from sums rather than silently counted as
 * zero tons — but for the % Diverted denominator we sum total tonnage from
 * whatever parses. Identical semantics to parseTonnage() in
 * artifacts/ticket-yard/src/lib/tonnage.ts. */
export function parseTonnage(weight: string | null | undefined): number | null {
  if (!weight) return null;
  const stripped = weight.replace(/tons?/gi, "").replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) return null;
  return Number.parseFloat(stripped);
}

// ─── Conservative vendor auto-suggest ────────────────────────────────────────
//
// Only ever fires on an unambiguous vendor match — anything not covered is
// left null ("needs review") rather than guessed, matching this codebase's
// suggestCostCode()/classifyWasteCategory() convention. Keep this table small
// and obvious.
type SuggestionRule = { pattern: RegExp; material: DiversionMaterial };

const VENDOR_RULES: SuggestionRule[] = [
  // Scrap-metal recyclers -> Metal (diverted).
  { pattern: /sa\s+recycling/i, material: "Metal" },
  { pattern: /\bsims\b/i, material: "Metal" },
  { pattern: /recycling/i, material: "Metal" },
  { pattern: /scrap/i, material: "Metal" },
  // Landfill / disposal vendors -> Residual/Trash (not diverted).
  { pattern: /\bdisposal\b/i, material: RESIDUAL_MATERIAL },
  { pattern: /\blandfill\b/i, material: RESIDUAL_MATERIAL },
  { pattern: /waste\s+management/i, material: RESIDUAL_MATERIAL },
  { pattern: /\bwm\b/i, material: RESIDUAL_MATERIAL },
];

/** Suggests a diversion material from a ticket's vendor. Returns null (never a
 * guess) unless a rule confidently matches — always a suggestion only; the UI
 * selector stays manually overridable. */
export function suggestDiversionMaterial(
  vendor: string | null | undefined,
): DiversionMaterial | null {
  const normalized = (vendor ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  for (const rule of VENDOR_RULES) {
    if (rule.pattern.test(normalized)) return rule.material;
  }
  return null;
}

// ─── Diversion math ──────────────────────────────────────────────────────────

export type DiversionRow = {
  date?: string | null;
  vendor?: string | null;
  weight?: string | null;
  ticketNumber?: string | null;
  jobNumber?: string | null;
  diversionMaterial?: string | null;
};

export type DiversionTotals = {
  /** Diverted tonnage per recyclable/scrap material (all six always present,
   * 0 when none). */
  perMaterial: Record<DivertedMaterial, number>;
  totalDiverted: number;
  residual: number;
  /** Sum of all parseable row tonnage (the % Diverted denominator). Includes
   * rows whose material is still null/unknown — they count toward the total
   * but not toward diverted, so they correctly lower the diversion rate. */
  totalTonnage: number;
  /** totalDiverted / totalTonnage, in 0..1. 0 when totalTonnage is 0 — never
   * NaN. */
  pctDiverted: number;
};

function emptyPerMaterial(): Record<DivertedMaterial, number> {
  const out = {} as Record<DivertedMaterial, number>;
  for (const m of DIVERTED_MATERIALS) out[m] = 0;
  return out;
}

export function computeDiversion(rows: DiversionRow[]): DiversionTotals {
  const perMaterial = emptyPerMaterial();
  let totalDiverted = 0;
  let residual = 0;
  let totalTonnage = 0;

  for (const row of rows) {
    const tons = parseTonnage(row.weight);
    if (tons === null) continue; // blank/garbage weight excluded from all sums
    totalTonnage += tons;
    const material = row.diversionMaterial ?? null;
    if (material === RESIDUAL_MATERIAL) {
      residual += tons;
    } else if (isDivertedMaterial(material)) {
      perMaterial[material as DivertedMaterial] += tons;
      totalDiverted += tons;
    }
    // null / unknown material: counted in totalTonnage only (needs review).
  }

  const pctDiverted = totalTonnage > 0 ? totalDiverted / totalTonnage : 0;
  return { perMaterial, totalDiverted, residual, totalTonnage, pctDiverted };
}

// ─── Month grouping ──────────────────────────────────────────────────────────

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_NAME_INDEX = new Map<string, number>();
for (let i = 0; i < MONTH_ABBR.length; i++) {
  MONTH_NAME_INDEX.set(MONTH_ABBR[i]!.toLowerCase(), i);
}
const MONTH_FULL = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
for (let i = 0; i < MONTH_FULL.length; i++) {
  MONTH_NAME_INDEX.set(MONTH_FULL[i]!, i);
}

/** Parses the free-text `date` field into { year, month } (month 1-12).
 * Tolerant of ISO (YYYY-MM-DD), US slash/dash (M/D/YY or MM/DD/YYYY), and
 * "Mon DD, YYYY" / "Month DD YYYY". Returns null when nothing parses so the
 * caller can bucket the row under "Undated" rather than guessing. */
export function parseMonthKey(
  date: string | null | undefined,
): { year: number; month: number } | null {
  if (!date) return null;
  const s = date.trim();

  // ISO: 2025-09-15
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }

  // US: 09/15/2025, 9-15-25
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (m) {
    const month = Number(m[1]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12) return { year, month };
  }

  // Month name: "Sep 15, 2025", "September 2025"
  m = /^([A-Za-z]{3,9})\.?\s+(?:\d{1,2},?\s+)?(\d{4})/.exec(s);
  if (m) {
    const idx = MONTH_NAME_INDEX.get(m[1]!.toLowerCase());
    if (idx !== undefined) return { year: Number(m[2]), month: idx + 1 };
  }

  return null;
}

export type DiversionMonth = {
  /** "YYYY-MM" for a dated bucket, or "unknown" for undated rows. */
  key: string;
  /** "Sep-25" for a dated bucket, or "Undated". */
  label: string;
  rows: DiversionRow[];
  totals: DiversionTotals;
};

function monthLabel(year: number, month: number): string {
  const yy = String(year % 100).padStart(2, "0");
  return `${MONTH_ABBR[month - 1]}-${yy}`;
}

/** Groups rows into ordered month buckets (ascending by YYYY-MM; any undated
 * rows go into a trailing "Undated" bucket so no ticket is silently dropped).
 * Each bucket carries its rows + computed totals. */
export function groupDiversionByMonth(rows: DiversionRow[]): DiversionMonth[] {
  const buckets = new Map<string, { label: string; sort: string; rows: DiversionRow[] }>();
  for (const row of rows) {
    const parsed = parseMonthKey(row.date);
    let key: string;
    let label: string;
    let sort: string;
    if (parsed) {
      key = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;
      label = monthLabel(parsed.year, parsed.month);
      sort = key;
    } else {
      key = "unknown";
      label = "Undated";
      sort = "9999-99"; // always last
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label, sort, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(row);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[1].sort < b[1].sort ? -1 : a[1].sort > b[1].sort ? 1 : 0))
    .map(([key, b]) => ({
      key,
      label: b.label,
      rows: b.rows,
      totals: computeDiversion(b.rows),
    }));
}

// ─── LEED workbook model (pure — no SheetJS dependency here) ─────────────────
//
// Produces the array-of-arrays model for ONE sheet PER MONTH mirroring the
// reference DHG layout. The web layer converts each sheet's `aoa` to a SheetJS
// worksheet (XLSX.utils.aoa_to_sheet) and writes the file; keeping the model
// pure makes it unit-testable with no browser/SheetJS.

export type LeedSheetModel = {
  /** Excel sheet name = the month label, e.g. "Sep-25". */
  name: string;
  /** Array-of-arrays cell grid for XLSX.utils.aoa_to_sheet. */
  aoa: (string | number)[][];
};

export type LeedWorkbookModel = {
  sheets: LeedSheetModel[];
};

export const LEED_COLUMNS = [
  "WO#",
  "Ticket #",
  "Date",
  "Location",
  "Total Tonnage",
  ...DIVERTED_MATERIALS,
  "Total Diverted",
  "Residual/Trash",
  "% Diverted",
] as const;

export type LeedReportOptions = {
  jobName?: string | null;
  /** DHG's "Location:" header — blank when we have none. */
  location?: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctString(fraction: number): string {
  return `${round2(fraction * 100).toFixed(2)}%`;
}

function buildSheetAoa(
  month: DiversionMonth,
  options: LeedReportOptions,
): (string | number)[][] {
  const aoa: (string | number)[][] = [];
  aoa.push(["Project:", options.jobName ?? ""]);
  aoa.push(["Location:", options.location ?? ""]);
  aoa.push([]);
  aoa.push([...LEED_COLUMNS]);

  for (const row of month.rows) {
    const tons = parseTonnage(row.weight);
    const total = tons ?? 0;
    const material = row.diversionMaterial ?? null;
    const diverted = isDivertedMaterial(material) ? total : 0;
    const residual = material === RESIDUAL_MATERIAL ? total : 0;
    const line: (string | number)[] = [
      row.jobNumber ?? "",
      row.ticketNumber ?? "",
      row.date ?? "",
      row.vendor ?? "",
      round2(total),
    ];
    for (const mat of DIVERTED_MATERIALS) {
      line.push(material === mat ? round2(total) : "");
    }
    line.push(round2(diverted));
    line.push(round2(residual));
    line.push(pctString(total > 0 ? diverted / total : 0));
    aoa.push(line);
  }

  // Monthly TOTAL row.
  const t = month.totals;
  const totalLine: (string | number)[] = ["TOTAL", "", "", "", round2(t.totalTonnage)];
  for (const mat of DIVERTED_MATERIALS) {
    totalLine.push(round2(t.perMaterial[mat]));
  }
  totalLine.push(round2(t.totalDiverted));
  totalLine.push(round2(t.residual));
  totalLine.push(pctString(t.pctDiverted));
  aoa.push(totalLine);

  return aoa;
}

/** Builds the multi-sheet LEED workbook model: one sheet per month present in
 * the tickets, each reproducing the reference layout (header rows, column
 * header, one row per ticket, and a monthly TOTAL row). */
export function buildLeedWorkbookModel(
  rows: DiversionRow[],
  options: LeedReportOptions = {},
): LeedWorkbookModel {
  const months = groupDiversionByMonth(rows);
  return {
    sheets: months.map((month) => ({
      name: month.label,
      aoa: buildSheetAoa(month, options),
    })),
  };
}
