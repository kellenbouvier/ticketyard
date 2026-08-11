import test from "node:test";
import assert from "node:assert/strict";
import { computeBudgetTotals, parseBudgetAmount } from "../src/index.ts";

test("parseBudgetAmount: strips $ , whitespace; blank/garbage -> 0, never NaN", () => {
  assert.equal(parseBudgetAmount("$1,250.50"), 1250.5);
  assert.equal(parseBudgetAmount("  2 000 "), 2000);
  assert.equal(parseBudgetAmount(""), 0);
  assert.equal(parseBudgetAmount("abc"), 0);
  assert.equal(parseBudgetAmount(null), 0);
  assert.equal(parseBudgetAmount(undefined), 0);
  assert.ok(!Number.isNaN(parseBudgetAmount("$")));
});

test("lump-only category: single non-coded line is the subtotal", () => {
  const t = computeBudgetTotals(
    [{ section: "Materials", costCode: null, label: "Materials", amount: "500" }],
    "2000",
  );
  assert.equal(t.sections.length, 1);
  assert.equal(t.sections[0].section, "Materials");
  assert.equal(t.sections[0].subtotal, 500);
  assert.equal(t.grandTotal, 500);
  assert.equal(t.target, 2000);
  assert.equal(t.remaining, 1500);
});

test("codes-only category: subtotal is the sum of coded lines", () => {
  const t = computeBudgetTotals(
    [
      { section: "Materials", costCode: "06-100", label: "Supplies", amount: "300" },
      { section: "Materials", costCode: "06-110", label: "Small Tools", amount: "200" },
    ],
    "1000",
  );
  assert.equal(t.sections.length, 1);
  assert.equal(t.sections[0].subtotal, 500);
  assert.equal(t.grandTotal, 500);
  assert.equal(t.remaining, 500);
});

test("hybrid category: coded lines + an Additional (non-coded) line", () => {
  const t = computeBudgetTotals(
    [
      { section: "Materials", costCode: "06-100", label: "Supplies", amount: "300" },
      { section: "Materials", costCode: null, label: "Additional Materials (non-coded)", amount: "150" },
    ],
    "1000",
  );
  assert.equal(t.sections.length, 1);
  assert.equal(t.sections[0].subtotal, 450);
  assert.equal(t.sections[0].lines.length, 2);
  assert.equal(t.grandTotal, 450);
});

test("empty category contributes 0 (absent sections just don't appear)", () => {
  const t = computeBudgetTotals(
    [{ section: "Materials", costCode: null, label: "Materials", amount: "" }],
    "1000",
  );
  assert.equal(t.sections.length, 1);
  assert.equal(t.sections[0].subtotal, 0);
  assert.equal(t.grandTotal, 0);
  assert.equal(t.remaining, 1000);
});

test("empty lines + zero target => everything 0", () => {
  const t = computeBudgetTotals([], "");
  assert.equal(t.sections.length, 0);
  assert.equal(t.grandTotal, 0);
  assert.equal(t.target, 0);
  assert.equal(t.remaining, 0);
});

test("over target: remaining is negative; under target: positive", () => {
  const over = computeBudgetTotals(
    [{ section: "Landfill", costCode: "05-110", label: "Landfill-External", amount: "1500" }],
    "1000",
  );
  assert.equal(over.grandTotal, 1500);
  assert.equal(over.remaining, -500);

  const under = computeBudgetTotals(
    [{ section: "Landfill", costCode: "05-110", label: "Landfill-External", amount: "400" }],
    "1000",
  );
  assert.equal(under.remaining, 600);
});

test("blank / messy amounts are treated as 0 within a mixed section", () => {
  const t = computeBudgetTotals(
    [
      { section: "Materials", costCode: "06-100", label: "Supplies", amount: "$1,000" },
      { section: "Materials", costCode: "06-110", label: "Small Tools", amount: "" },
      { section: "Materials", costCode: null, label: "Additional Materials (non-coded)", amount: "  50 " },
    ],
    "$3,000",
  );
  assert.equal(t.sections[0].subtotal, 1050);
  assert.equal(t.grandTotal, 1050);
  assert.equal(t.target, 3000);
  assert.equal(t.remaining, 1950);
});

test("multiple sections are ordered by the canonical cost-code section order", () => {
  const t = computeBudgetTotals(
    [
      { section: "Materials", costCode: null, label: "Materials", amount: "100" },
      { section: "Equipment-Internal", costCode: "03-180", label: "Pickup Truck", amount: "200" },
      { section: "Landfill", costCode: "05-110", label: "Landfill-External", amount: "300" },
    ],
    "1000",
  );
  assert.deepEqual(
    t.sections.map((s) => s.section),
    ["Equipment-Internal", "Landfill", "Materials"],
  );
  assert.equal(t.grandTotal, 600);
  assert.equal(t.remaining, 400);
});
