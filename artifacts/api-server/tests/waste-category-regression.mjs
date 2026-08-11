import assert from "node:assert/strict";
import { classifyWasteCategory } from "../src/routes/tickets.ts";

// D.H. Griffin tracks C&D landfill and inert/concrete recycling completely
// separately — the vendor classifier is the only thing standing between a
// ticket and the wrong category, so it gets its own direct unit test rather
// than relying only on OCR-pipeline fixtures. The category is only
// meaningful for landfill/inert-landfill tickets: the classifier NEVER
// defaults to "C&D", returning null ("N/A") for any non-landfill vendor.
const cases = [
  // Inert / concrete recycling vendors.
  ["Metro Green Recycling, LLC", "Inert"],
  ["METRO GREEN RECYCLING", "Inert"],
  ["Vulcan Materials", "Inert"],
  // The historical bug: this was mistyped as "volk and materials" and
  // could never match any real vendor name. Assert the real spelling works.
  ["Vulcan Materials Company", "Inert"],
  ["VULCAN MATERIALS, INC.", "Inert"],
  // C&D landfill / general disposal vendors.
  ["Willow Oak Landfill", "C&D"],
  ["121 Disposal", "C&D"],
  ["Waste Management of Carolina", "C&D"],
  ["Some County Landfill", "C&D"],
  // Non-landfill tickets: NO forced default — category stays null ("N/A").
  ["D.H. Griffin Wrecking", null],
  ["Home Depot #4021", null],
  ["SA Recycling", null],
  ["", null],
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
