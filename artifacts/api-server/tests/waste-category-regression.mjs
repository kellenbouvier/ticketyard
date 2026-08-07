import assert from "node:assert/strict";
import { classifyWasteCategory } from "../src/routes/tickets.ts";

// D.H. Griffin tracks C&D landfill and inert/concrete recycling completely
// separately — the vendor default classifier is the only thing standing
// between a ticket and the wrong category, so it gets its own direct unit
// test rather than relying only on OCR-pipeline fixtures.
const cases = [
  ["Metro Green Recycling, LLC", "Inert"],
  ["METRO GREEN RECYCLING", "Inert"],
  ["Vulcan Materials", "Inert"],
  // The historical bug: this was mistyped as "volk and materials" and
  // could never match any real vendor name, so Vulcan tickets silently
  // fell through to C&D. Assert the exact real-world spelling works.
  ["Vulcan Materials Company", "Inert"],
  ["VULCAN MATERIALS, INC.", "Inert"],
  ["Willow Oak Landfill", "C&D"],
  ["D.H. Griffin Wrecking", "C&D"],
  ["", "C&D"],
];

for (const [vendor, expected] of cases) {
  const actual = classifyWasteCategory(vendor);
  assert.equal(
    actual,
    expected,
    `classifyWasteCategory(${JSON.stringify(vendor)}) expected ${expected}, got ${actual}`,
  );
  console.log(`passed: ${JSON.stringify(vendor)} -> ${actual}`);
}
