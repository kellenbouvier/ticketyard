/** Flexible job-budgeting math — the SINGLE source of truth reused by the
 * API (PUT validation echo), the web UI (live totals) and the unit tests so
 * every layer agrees on subtotals, grand total, and remaining-vs-target.
 *
 * There is NO method_type: a category (a cost-code SECTION — see
 * @workspace/cost-codes) can freely hold a single lump-sum line, a set of
 * cost-code line items, or BOTH (hybrid: coded lines plus an optional
 * "Additional [Category] (non-coded)" line). This module never cares which
 * shape a section is in — it just sums every line's amount. */
import { costCodesBySection } from "@workspace/cost-codes";

export type BudgetLineInput = {
  section: string;
  /** null = a lump-sum or "Additional (non-coded)" line; a string = a
   * cost-code line (the code lives in the shared taxonomy). */
  costCode: string | null;
  label: string;
  /** Money as entered/stored — parsed with parseBudgetAmount below. */
  amount: string;
};

export type BudgetSectionTotal = {
  section: string;
  subtotal: number;
  lines: BudgetLineInput[];
};

export type BudgetTotals = {
  sections: BudgetSectionTotal[];
  grandTotal: number;
  target: number;
  /** target - grandTotal. Positive = still under target (money left to
   * allocate); negative = over target. */
  remaining: number;
};

/** Parse money identically to the rest of the app (see
 * costCodeTotals.parseCurrencyAmount / tickets.amount handling): strip $,
 * commas and whitespace; blank or garbage becomes 0, never NaN. */
export function parseBudgetAmount(amount: string | null | undefined): number {
  if (amount == null) return 0;
  const n = Number(String(amount).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Compute per-section subtotals, the grand total, and remaining vs target
 * from a flat list of budget lines. Sections are ordered by the canonical
 * cost-code section order (so the API and UI always agree on ordering),
 * with any section not in the taxonomy appended in first-seen order. Empty
 * sections contribute 0 and are simply absent from the result. */
export function computeBudgetTotals(
  lines: BudgetLineInput[],
  target: string | number | null | undefined,
): BudgetTotals {
  const bySection = new Map<string, BudgetLineInput[]>();
  for (const line of lines) {
    let bucket = bySection.get(line.section);
    if (!bucket) {
      bucket = [];
      bySection.set(line.section, bucket);
    }
    bucket.push(line);
  }

  // Canonical ordering first, then any extra (unknown) sections seen in the
  // input, preserving first-seen order.
  const orderedSections: string[] = [];
  const seen = new Set<string>();
  for (const { section } of costCodesBySection()) {
    if (bySection.has(section) && !seen.has(section)) {
      orderedSections.push(section);
      seen.add(section);
    }
  }
  for (const line of lines) {
    if (!seen.has(line.section)) {
      orderedSections.push(line.section);
      seen.add(line.section);
    }
  }

  const sections: BudgetSectionTotal[] = [];
  let grandTotal = 0;
  for (const section of orderedSections) {
    const sectionLines = bySection.get(section) ?? [];
    let subtotal = 0;
    for (const line of sectionLines) subtotal += parseBudgetAmount(line.amount);
    grandTotal += subtotal;
    sections.push({ section, subtotal, lines: sectionLines });
  }

  const targetNum =
    typeof target === "number" ? (Number.isFinite(target) ? target : 0) : parseBudgetAmount(target);

  return {
    sections,
    grandTotal,
    target: targetNum,
    remaining: targetNum - grandTotal,
  };
}
