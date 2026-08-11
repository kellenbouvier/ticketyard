import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COST_CODES,
  costCodeByCode,
  costCodesBySection,
  formatCostCode,
  isKnownCostCode,
  isLandfillCostCode,
  suggestCostCode,
} from "../src/index.ts";

test("seeds exactly the DHG taxonomy (14 codes across 9 sections)", () => {
  assert.equal(COST_CODES.length, 14);
  const sections = new Set(COST_CODES.map((c) => c.section));
  assert.equal(sections.size, 9);
  // No duplicate codes.
  assert.equal(new Set(COST_CODES.map((c) => c.code)).size, COST_CODES.length);
});

test("costCodeByCode looks up a known code and rejects unknown/null", () => {
  assert.deepEqual(costCodeByCode("05-110"), { section: "Landfill", code: "05-110", name: "Landfill-External" });
  assert.equal(costCodeByCode("99-999"), undefined);
  assert.equal(costCodeByCode(null), undefined);
  assert.equal(costCodeByCode(undefined), undefined);
});

test("isKnownCostCode: null/undefined are always valid (needs review), unknown strings are not", () => {
  assert.equal(isKnownCostCode(null), true);
  assert.equal(isKnownCostCode(undefined), true);
  assert.equal(isKnownCostCode("03-180"), true);
  assert.equal(isKnownCostCode("03-100"), false); // the ambiguous scan alternative — deliberately not seeded
  assert.equal(isKnownCostCode("not-a-code"), false);
});

test("isLandfillCostCode is true only for the 05-xxx section", () => {
  assert.equal(isLandfillCostCode("05-110"), true);
  assert.equal(isLandfillCostCode("06-100"), false);
  assert.equal(isLandfillCostCode(null), false);
});

test("formatCostCode renders 'code — name' from an entry or a raw code string", () => {
  assert.equal(formatCostCode({ section: "Landfill", code: "05-110", name: "Landfill-External" }), "05-110 — Landfill-External");
  assert.equal(formatCostCode("06-100"), "06-100 — Supplies");
  assert.equal(formatCostCode(null), "");
  assert.equal(formatCostCode(undefined), "");
});

test("costCodesBySection preserves taxonomy order and groups every code exactly once", () => {
  const grouped = costCodesBySection();
  assert.deepEqual(
    grouped.map((g) => g.section),
    [
      "Equipment-Internal",
      "Equipment-External",
      "Landfill",
      "Materials",
      "Subcontracts",
      "Per Diem",
      "Lodging/Travel",
      "Other-Job Cost",
      "Overhead",
    ],
  );
  const total = grouped.reduce((sum, g) => sum + g.codes.length, 0);
  assert.equal(total, COST_CODES.length);
});

test("suggestCostCode: fires only for unambiguous, well-known vendors", () => {
  assert.equal(suggestCostCode("Metro Green Recycling, LLC"), "05-110");
  assert.equal(suggestCostCode("Vulcan Materials"), "05-110");
  assert.equal(suggestCostCode("Waste Management of Carolina"), "05-110");
  assert.equal(suggestCostCode("Willow Oak Landfill"), "05-110");
  assert.equal(suggestCostCode("SA Recycling"), "05-110");
  assert.equal(suggestCostCode("Sims Metal Management"), "05-110");
  assert.equal(suggestCostCode("Home Depot #4021"), "06-100");
  assert.equal(suggestCostCode("Ace Hardware"), "06-100");
  assert.equal(suggestCostCode("O'Reilly Auto Parts"), "06-100");
  assert.equal(suggestCostCode("NAPA Auto Parts"), "06-100");
  assert.equal(suggestCostCode("AutoZone"), "06-100");
  assert.equal(suggestCostCode("Advance Auto Parts"), "06-100");
  assert.equal(suggestCostCode("Comfort Inn & Suites"), "09-135");
});

test("suggestCostCode: description-based subcontractor rule", () => {
  assert.equal(suggestCostCode("ABC Grading LLC", "Subcontract labor - site grading"), "07-115");
  assert.equal(suggestCostCode(null, "Subcontractor invoice"), "07-115");
});

test("suggestCostCode: never guesses on an unknown/ambiguous vendor", () => {
  assert.equal(suggestCostCode("Some Random Company"), null);
  assert.equal(suggestCostCode(""), null);
  assert.equal(suggestCostCode(null), null);
  assert.equal(suggestCostCode(undefined, undefined), null);
});

test("every suggestCostCode() result is a known taxonomy code", () => {
  const vendors = [
    "Metro Green Recycling, LLC",
    "Vulcan Materials",
    "Waste Management",
    "Willow Oak Landfill",
    "SA Recycling",
    "Sims",
    "Home Depot",
    "Ace Hardware",
    "O'Reilly",
    "NAPA",
    "AutoZone",
    "Advance Auto",
    "Comfort Inn",
  ];
  for (const vendor of vendors) {
    const code = suggestCostCode(vendor);
    assert.ok(code, `expected a suggestion for ${vendor}`);
    assert.ok(isKnownCostCode(code), `${code} (suggested for ${vendor}) is not a known code`);
  }
});
