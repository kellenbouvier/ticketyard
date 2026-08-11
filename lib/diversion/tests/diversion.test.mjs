import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIVERSION_MATERIALS,
  DIVERTED_MATERIALS,
  RESIDUAL_MATERIAL,
  isKnownDiversionMaterial,
  isDivertedMaterial,
  suggestDiversionMaterial,
  computeDiversion,
  groupDiversionByMonth,
  parseMonthKey,
  buildLeedWorkbookModel,
  LEED_COLUMNS,
} from "../src/index.ts";

test("taxonomy: 7 materials, 6 diverted + Residual/Trash, ordered", () => {
  assert.equal(DIVERSION_MATERIALS.length, 7);
  assert.equal(DIVERTED_MATERIALS.length, 6);
  assert.equal(RESIDUAL_MATERIAL, "Residual/Trash");
  assert.deepEqual([...DIVERTED_MATERIALS], [
    "Concrete", "Asphalt", "Metal", "Wood", "Paper/Cardboard", "Masonry/Brick",
  ]);
  assert.equal(DIVERSION_MATERIALS[6], "Residual/Trash");
});

test("isKnownDiversionMaterial: null/undefined valid; known valid; unknown invalid", () => {
  assert.equal(isKnownDiversionMaterial(null), true);
  assert.equal(isKnownDiversionMaterial(undefined), true);
  assert.equal(isKnownDiversionMaterial("Metal"), true);
  assert.equal(isKnownDiversionMaterial("Residual/Trash"), true);
  assert.equal(isKnownDiversionMaterial("Plutonium"), false);
  assert.equal(isKnownDiversionMaterial("metal"), false); // case-sensitive
});

test("isDivertedMaterial: true for recyclables, false for residual/null/unknown", () => {
  assert.equal(isDivertedMaterial("Concrete"), true);
  assert.equal(isDivertedMaterial("Metal"), true);
  assert.equal(isDivertedMaterial("Residual/Trash"), false);
  assert.equal(isDivertedMaterial(null), false);
  assert.equal(isDivertedMaterial("Unknown"), false);
});

test("suggestDiversionMaterial: SA Recycling->Metal, 121 Disposal->Residual, unknown->null", () => {
  assert.equal(suggestDiversionMaterial("SA Recycling"), "Metal");
  assert.equal(suggestDiversionMaterial("Sims Metal Management"), "Metal");
  assert.equal(suggestDiversionMaterial("Acme Scrap Yard"), "Metal");
  assert.equal(suggestDiversionMaterial("121 Disposal"), "Residual/Trash");
  assert.equal(suggestDiversionMaterial("Waste Management"), "Residual/Trash");
  assert.equal(suggestDiversionMaterial("County Landfill"), "Residual/Trash");
  assert.equal(suggestDiversionMaterial("Joe's Concrete Supply"), null);
  assert.equal(suggestDiversionMaterial(""), null);
  assert.equal(suggestDiversionMaterial(null), null);
});

test("computeDiversion: per-material, diverted vs residual, % diverted, blank tonnage", () => {
  const rows = [
    { weight: "10 Tons", diversionMaterial: "Metal" },
    { weight: "5 tons", diversionMaterial: "Concrete" },
    { weight: "5", diversionMaterial: "Residual/Trash" },
    { weight: "", diversionMaterial: "Metal" }, // blank -> excluded entirely
    { weight: "garbage", diversionMaterial: "Wood" }, // unparseable -> excluded
    { weight: "3 Tons", diversionMaterial: null }, // needs review: counts in total only
  ];
  const t = computeDiversion(rows);
  assert.equal(t.perMaterial.Metal, 10);
  assert.equal(t.perMaterial.Concrete, 5);
  assert.equal(t.perMaterial.Wood, 0);
  assert.equal(t.totalDiverted, 15);
  assert.equal(t.residual, 5);
  assert.equal(t.totalTonnage, 23); // 10+5+5+3 (blank/garbage excluded)
  assert.equal(round(t.pctDiverted), round(15 / 23));
});

test("computeDiversion: empty / all-blank -> 0, never NaN", () => {
  assert.equal(computeDiversion([]).pctDiverted, 0);
  const t = computeDiversion([{ weight: "", diversionMaterial: "Metal" }]);
  assert.equal(t.totalTonnage, 0);
  assert.equal(t.pctDiverted, 0);
  assert.ok(!Number.isNaN(t.pctDiverted));
});

test("parseMonthKey: ISO / US / month-name / undated", () => {
  assert.deepEqual(parseMonthKey("2025-09-15"), { year: 2025, month: 9 });
  assert.deepEqual(parseMonthKey("09/15/2025"), { year: 2025, month: 9 });
  assert.deepEqual(parseMonthKey("9-3-25"), { year: 2025, month: 9 });
  assert.deepEqual(parseMonthKey("Oct 2, 2025"), { year: 2025, month: 10 });
  assert.deepEqual(parseMonthKey("September 2025"), { year: 2025, month: 9 });
  assert.equal(parseMonthKey("not a date"), null);
  assert.equal(parseMonthKey(""), null);
});

test("groupDiversionByMonth: multi-month ordering + labels + undated last", () => {
  const rows = [
    { date: "10/05/2025", weight: "4 Tons", diversionMaterial: "Metal" },
    { date: "2025-09-15", weight: "6 Tons", diversionMaterial: "Concrete" },
    { date: "09/20/2025", weight: "2 Tons", diversionMaterial: "Residual/Trash" },
    { date: "bad", weight: "1 Tons", diversionMaterial: "Wood" },
  ];
  const months = groupDiversionByMonth(rows);
  assert.equal(months.length, 3);
  assert.deepEqual(months.map((m) => m.key), ["2025-09", "2025-10", "unknown"]);
  assert.deepEqual(months.map((m) => m.label), ["Sep-25", "Oct-25", "Undated"]);
  // Sep bucket: 6 diverted (concrete) + 2 residual = 8 total, 75% diverted.
  const sep = months[0];
  assert.equal(sep.totals.totalTonnage, 8);
  assert.equal(sep.totals.totalDiverted, 6);
  assert.equal(sep.totals.residual, 2);
  assert.equal(round(sep.totals.pctDiverted), 0.75);
});

test("buildLeedWorkbookModel: one sheet per month, layout + totals", () => {
  const rows = [
    { date: "2025-09-15", weight: "6 Tons", diversionMaterial: "Concrete", ticketNumber: "T1", jobNumber: "WO100", vendor: "Metro" },
    { date: "2025-09-20", weight: "2 Tons", diversionMaterial: "Residual/Trash", ticketNumber: "T2", jobNumber: "WO100", vendor: "121 Disposal" },
    { date: "2025-10-05", weight: "4 Tons", diversionMaterial: "Metal", ticketNumber: "T3", jobNumber: "WO100", vendor: "SA Recycling" },
  ];
  const wb = buildLeedWorkbookModel(rows, { jobName: "Test Job", location: "" });
  assert.equal(wb.sheets.length, 2);
  assert.deepEqual(wb.sheets.map((s) => s.name), ["Sep-25", "Oct-25"]);

  const sep = wb.sheets[0].aoa;
  assert.deepEqual(sep[0], ["Project:", "Test Job"]);
  assert.deepEqual(sep[1], ["Location:", ""]);
  assert.deepEqual(sep[3], [...LEED_COLUMNS]);
  // First ticket row: WO#, Ticket#, Date, Location, Total, then material cols.
  const r1 = sep[4];
  assert.equal(r1[0], "WO100");
  assert.equal(r1[1], "T1");
  assert.equal(r1[4], 6); // total tonnage
  assert.equal(r1[5], 6); // Concrete column
  assert.equal(r1[LEED_COLUMNS.indexOf("Total Diverted")], 6);
  assert.equal(r1[LEED_COLUMNS.indexOf("% Diverted")], "100.00%");
  // Monthly TOTAL row is last: 6 diverted / 8 total = 75%.
  const total = sep[sep.length - 1];
  assert.equal(total[0], "TOTAL");
  assert.equal(total[4], 8);
  assert.equal(total[LEED_COLUMNS.indexOf("Total Diverted")], 6);
  assert.equal(total[LEED_COLUMNS.indexOf("Residual/Trash")], 2);
  assert.equal(total[LEED_COLUMNS.indexOf("% Diverted")], "75.00%");
});

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
