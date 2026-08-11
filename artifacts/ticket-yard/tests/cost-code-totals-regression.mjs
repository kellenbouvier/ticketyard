import assert from "node:assert/strict";
import { computeCostCodeTotals } from "../src/lib/costCodeTotals.ts";

// Two tickets on the same code roll up together; a null costCode (never
// guessed) and an unrecognized string both land in the "unassigned" bucket
// rather than being dropped or silently attributed to a section.
const rows = [
  { costCode: "05-110", amount: "$100.00" },
  { costCode: "05-110", amount: "$50.50" },
  { costCode: "06-100", amount: "$20.00" },
  { costCode: null, amount: "$75.00" },
  { costCode: "99-999", amount: "$10.00" }, // defensively unassigned, not a crash
];

const totals = computeCostCodeTotals(rows);

assert.equal(totals.grandTotal, 255.5, "grand total sums every row regardless of assignment");
assert.equal(totals.unassignedAmount, 85, "null + unknown codes land in unassigned");
assert.equal(totals.unassignedCount, 2);

const landfillSection = totals.sections.find((s) => s.section === "Landfill");
assert.ok(landfillSection, "Landfill section present");
assert.equal(landfillSection.amount, 150.5);
assert.equal(landfillSection.count, 2);
assert.equal(landfillSection.codes.length, 1);
assert.equal(landfillSection.codes[0].code, "05-110");
assert.equal(landfillSection.codes[0].amount, 150.5);
assert.equal(landfillSection.codes[0].count, 2);

const materialsSection = totals.sections.find((s) => s.section === "Materials");
assert.ok(materialsSection, "Materials section present");
assert.equal(materialsSection.amount, 20);

// Sections with no assigned tickets are omitted entirely, not shown as $0 rows.
assert.ok(!totals.sections.some((s) => s.section === "Overhead"));

console.log("all cost-code-totals assertions passed");

// Blank/garbage amounts never crash the aggregation — they contribute $0,
// matching the dashboard's existing amount-parsing convention.
const empty = computeCostCodeTotals([{ costCode: "05-110", amount: "" }]);
assert.equal(empty.sections[0].amount, 0);
assert.equal(empty.grandTotal, 0);
console.log("blank-amount handling passed");
