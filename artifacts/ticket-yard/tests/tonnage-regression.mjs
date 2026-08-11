import assert from "node:assert/strict";
import { parseTonnage } from "../src/lib/tonnage.ts";

// weight is free-text OCR output (see extractTonsWeight() in the API
// server) — the parser must tolerate the unit word, thousands separators,
// and surrounding whitespace, but must never guess a number out of
// garbage input. A null result means "exclude from tonnage sums," never
// "treat as zero."
const cases = [
  ["12.34 Tons", 12.34],
  ["1,234.5 tons", 1234.5],
  ["  45.6   Tons  ", 45.6],
  ["12.5ton", 12.5],
  ["0.75 Tons", 0.75],
  ["", null],
  ["   ", null],
  ["n/a", null],
  ["Tons", null],
  ["12.34 lbs", null],
  [null, null],
  [undefined, null],
];

for (const [input, expected] of cases) {
  const actual = parseTonnage(input);
  assert.equal(
    actual,
    expected,
    `parseTonnage(${JSON.stringify(input)}) expected ${expected}, got ${actual}`,
  );
  console.log(`passed: ${JSON.stringify(input)} -> ${actual}`);
}
