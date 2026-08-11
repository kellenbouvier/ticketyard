import assert from "node:assert/strict";
import {
  COST_CODE_FILTER_ALL,
  COST_CODE_FILTER_UNASSIGNED,
  filterRowsByCostCode,
  filterCostCodeTotals,
  rowMatchesCostCodeFilter,
} from "../src/lib/costCodeFilter.ts";
import { computeCostCodeTotals } from "../src/lib/costCodeTotals.ts";

const rows = [
  { costCode: "05-110", amount: "$100.00" },
  { costCode: "05-110", amount: "$50.50" },
  { costCode: "06-100", amount: "$20.00" },
  { costCode: null, amount: "$75.00" },
  { costCode: "00-000", amount: "$10.00" }, // not a real DHG code -> needs review
];

// "All" is a passthrough for both rows and totals.
assert.equal(filterRowsByCostCode(rows, COST_CODE_FILTER_ALL).length, 5);
const allTotals = computeCostCodeTotals(rows);
assert.deepEqual(filterCostCodeTotals(allTotals, COST_CODE_FILTER_ALL), allTotals);

// A specific code narrows rows AND totals to just that code's subtotal.
const landfillRows = filterRowsByCostCode(rows, "05-110");
assert.equal(landfillRows.length, 2);
assert.ok(landfillRows.every((r) => r.costCode === "05-110"));
const landfillTotals = filterCostCodeTotals(allTotals, "05-110");
assert.equal(landfillTotals.sections.length, 1);
assert.equal(landfillTotals.sections[0].codes.length, 1);
assert.equal(landfillTotals.sections[0].codes[0].code, "05-110");
assert.equal(landfillTotals.grandTotal, 150.5, "filtered grand total == that code's subtotal");
assert.equal(landfillTotals.unassignedCount, 0);

// "Needs review" keeps only null/unrecognized rows and the unassigned bucket.
const reviewRows = filterRowsByCostCode(rows, COST_CODE_FILTER_UNASSIGNED);
assert.equal(reviewRows.length, 2, "null + unknown code");
assert.ok(rowMatchesCostCodeFilter({ costCode: null }, COST_CODE_FILTER_UNASSIGNED));
assert.ok(rowMatchesCostCodeFilter({ costCode: "00-000" }, COST_CODE_FILTER_UNASSIGNED));
assert.ok(!rowMatchesCostCodeFilter({ costCode: "05-110" }, COST_CODE_FILTER_UNASSIGNED));
const reviewTotals = filterCostCodeTotals(allTotals, COST_CODE_FILTER_UNASSIGNED);
assert.equal(reviewTotals.sections.length, 0);
assert.equal(reviewTotals.unassignedCount, 2);
assert.equal(reviewTotals.grandTotal, 85);

// A code with no tickets in scope yields an empty result, not a crash.
const emptyTotals = filterCostCodeTotals(allTotals, "03-180");
assert.equal(emptyTotals.sections.length, 0);
assert.equal(emptyTotals.grandTotal, 0);

console.log("all cost-code-filter assertions passed");
