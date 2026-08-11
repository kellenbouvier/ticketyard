import { costCodeByCode, costCodesBySection } from '@workspace/cost-codes';

export type CostCodeTotalRow = { code: string; name: string; amount: number; count: number };
export type CostCodeSectionTotal = { section: string; amount: number; count: number; codes: CostCodeTotalRow[] };
export type CostCodeTotals = {
  sections: CostCodeSectionTotal[];
  unassignedAmount: number;
  unassignedCount: number;
  grandTotal: number;
};

function parseCurrencyAmount(amount: string): number {
  return Number(amount.replace(/[$,\s]/g, '')) || 0;
}

/** Groups ticket amounts by cost code and section, mirroring the D.H.
 * Griffin "JC Entries by Job" report's section subtotals. Any ticket with
 * no cost code (or, defensively, an unrecognized one) falls into an
 * "unassigned" bucket rather than being dropped or guessed into a section —
 * matching this codebase's "never guess" convention. */
export function computeCostCodeTotals(rows: { costCode: string | null; amount: string }[]): CostCodeTotals {
  const statsByCode = new Map<string, { amount: number; count: number }>();
  let unassignedAmount = 0;
  let unassignedCount = 0;
  let grandTotal = 0;

  for (const row of rows) {
    const amount = parseCurrencyAmount(row.amount);
    grandTotal += amount;
    const entry = costCodeByCode(row.costCode);
    if (!entry) {
      unassignedAmount += amount;
      unassignedCount += 1;
      continue;
    }
    const stats = statsByCode.get(entry.code) ?? { amount: 0, count: 0 };
    stats.amount += amount;
    stats.count += 1;
    statsByCode.set(entry.code, stats);
  }

  const sections: CostCodeSectionTotal[] = [];
  for (const { section, codes } of costCodesBySection()) {
    const codeRows: CostCodeTotalRow[] = [];
    let sectionAmount = 0;
    let sectionCount = 0;
    for (const entry of codes) {
      const stats = statsByCode.get(entry.code);
      if (!stats) continue;
      codeRows.push({ code: entry.code, name: entry.name, amount: stats.amount, count: stats.count });
      sectionAmount += stats.amount;
      sectionCount += stats.count;
    }
    if (codeRows.length) sections.push({ section, amount: sectionAmount, count: sectionCount, codes: codeRows });
  }

  return { sections, unassignedAmount, unassignedCount, grandTotal };
}
