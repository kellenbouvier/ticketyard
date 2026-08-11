import { costCodeByCode, formatCostCode } from '@workspace/cost-codes';
import type { CostCodeTotals } from './costCodeTotals';

// In-page cost-code filter selection. Pure client-side derived state — no
// network call, no reload. "all" (default) shows everything; "unassigned"
// shows only the null/unknown "needs review" bucket; any other value is a
// specific cost code.
export const COST_CODE_FILTER_ALL = 'all';
export const COST_CODE_FILTER_UNASSIGNED = 'unassigned';
export type CostCodeFilter = string;

/** Does a ticket row match the active cost-code filter? A row counts as
 * "unassigned" when its costCode is null OR an unrecognized string (mirrors
 * computeCostCodeTotals' unassigned bucket — never guessed into a section). */
export function rowMatchesCostCodeFilter(
  row: { costCode: string | null },
  filter: CostCodeFilter,
): boolean {
  if (filter === COST_CODE_FILTER_ALL) return true;
  if (filter === COST_CODE_FILTER_UNASSIGNED) return !costCodeByCode(row.costCode);
  return row.costCode === filter;
}

/** Narrow a list of ticket rows to the active filter. */
export function filterRowsByCostCode<T extends { costCode: string | null }>(
  rows: T[],
  filter: CostCodeFilter,
): T[] {
  if (filter === COST_CODE_FILTER_ALL) return rows;
  return rows.filter((r) => rowMatchesCostCodeFilter(r, filter));
}

/** Narrow an already-aggregated CostCodeTotals to the active filter so the
 * Cost Code Totals panel matches the filtered register. "all" is a
 * passthrough; "unassigned" keeps only the needs-review bucket; a specific
 * code keeps only that one code's line item and section subtotal. */
export function filterCostCodeTotals(
  totals: CostCodeTotals,
  filter: CostCodeFilter,
): CostCodeTotals {
  if (filter === COST_CODE_FILTER_ALL) return totals;
  if (filter === COST_CODE_FILTER_UNASSIGNED) {
    return {
      sections: [],
      unassignedAmount: totals.unassignedAmount,
      unassignedCount: totals.unassignedCount,
      grandTotal: totals.unassignedAmount,
    };
  }
  for (const section of totals.sections) {
    const code = section.codes.find((c) => c.code === filter);
    if (code) {
      return {
        sections: [{ section: section.section, amount: code.amount, count: code.count, codes: [code] }],
        unassignedAmount: 0,
        unassignedCount: 0,
        grandTotal: code.amount,
      };
    }
  }
  // Selected code has no tickets in this scope — empty result, not a crash.
  return { sections: [], unassignedAmount: 0, unassignedCount: 0, grandTotal: 0 };
}

/** Human-readable label for the active filter (for report headers, etc.). */
export function costCodeFilterLabel(filter: CostCodeFilter): string {
  if (filter === COST_CODE_FILTER_ALL) return 'All cost codes';
  if (filter === COST_CODE_FILTER_UNASSIGNED) return 'Needs review';
  return formatCostCode(filter) || filter;
}
