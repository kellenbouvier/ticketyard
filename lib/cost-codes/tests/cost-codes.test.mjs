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

test("loads the COMPLETE DHG Standard Cost Code List (full taxonomy, not the old 14-entry seed)", () => {
  // The full DHG list is large — assert a high count rather than an exact
  // magic number so adding/removing a code upstream doesn't break the suite.
  assert.ok(COST_CODES.length >= 200, `expected the full list (>=200), got ${COST_CODES.length}`);
  const sections = new Set(COST_CODES.map((c) => c.section));
  assert.ok(sections.size >= 15, `expected all DHG groups (>=15 sections), got ${sections.size}`);
  // No duplicate codes.
  assert.equal(new Set(COST_CODES.map((c) => c.code)).size, COST_CODES.length);
  // Every entry is fully shaped.
  for (const c of COST_CODES) {
    assert.ok(c.section && c.code && c.name, `malformed entry ${JSON.stringify(c)}`);
  }
});

test("includes key codes across the full taxonomy", () => {
  // A spread of codes that only exist in the FULL list (not the old seed).
  for (const code of ["01-100", "02-120", "03-101", "05-000", "05-110", "06-100", "09-135", "50-100", "99-999"]) {
    assert.ok(costCodeByCode(code), `expected full-list code ${code} to exist`);
    assert.equal(isKnownCostCode(code), true);
  }
  assert.equal(costCodeByCode("02-120").name, "Fuel-Diesel");
  assert.equal(costCodeByCode("02-120").section, "Trucking/Hauling");
});

test("costCodeByCode looks up a known code and rejects unknown/null", () => {
  assert.deepEqual(costCodeByCode("05-110"), { section: "Landfill", code: "05-110", name: "Landfill-External" });
  assert.equal(costCodeByCode("00-000"), undefined); // not a real DHG code
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

test("isLandfillCostCode is true for any 05-xxx (Landfill) code, false otherwise", () => {
  assert.equal(isLandfillCostCode("05-000"), true);
  assert.equal(isLandfillCostCode("05-100"), true);
  assert.equal(isLandfillCostCode("05-110"), true);
  assert.equal(isLandfillCostCode("06-100"), false);
  assert.equal(isLandfillCostCode("50-100"), false); // Scrap Sales starts "50", not "05"
  assert.equal(isLandfillCostCode(null), false);
  assert.equal(isLandfillCostCode(undefined), false);
});

test("formatCostCode renders 'code — name' from an entry or a raw code string", () => {
  assert.equal(formatCostCode({ section: "Landfill", code: "05-110", name: "Landfill-External" }), "05-110 — Landfill-External");
  assert.equal(formatCostCode("06-100"), "06-100 — Supplies");
  assert.equal(formatCostCode(null), "");
  assert.equal(formatCostCode(undefined), "");
});

test("costCodesBySection preserves DHG group order and groups every code exactly once", () => {
  const grouped = costCodesBySection();
  // The full DHG group order (see cost_codes.json "groups").
  assert.deepEqual(
    grouped.map((g) => g.section),
    [
      "Labor & Payroll",
      "Trucking/Hauling",
      "Equipment-Internal",
      "Equipment-External",
      "Landfill",
      "Materials",
      "Subcontracts",
      "Per Diem",
      "Lodging/Travel",
      "Bonds/Permits",
      "Utilities",
      "Other-Job Cost",
      "Overhead",
      "Scrap Sales",
      "Estimate Adjustment",
    ],
  );
  // Every code lands in exactly one section, no drops or duplicates.
  const total = grouped.reduce((sum, g) => sum + g.codes.length, 0);
  assert.equal(total, COST_CODES.length);
  // Sections are non-empty and contain no duplicate codes across groups.
  const allCodes = grouped.flatMap((g) => g.codes.map((c) => c.code));
  assert.equal(new Set(allCodes).size, allCodes.length);
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
