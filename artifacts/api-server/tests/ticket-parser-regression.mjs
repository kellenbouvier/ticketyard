import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const apiUrl = process.env.TICKETYARD_API_URL ?? "http://127.0.0.1:8080";

// These fixtures are real ticket/invoice photos, not synthetic images, so
// OCR noise varies slightly between Tesseract/ImageMagick versions and
// even between runs on the same machine. The parser must never produce a
// wrong, non-blank value (see AUDIT.md C-1) — it may leave a field blank
// when it can't confidently anchor a value to a label, but it must never
// fall back to a nearby label, heading, or unrelated number. Expected
// values below are therefore only the fields this parser can anchor to an
// explicit label/shape on the document; anything else must stay blank.
const fixtures = [
  {
    fileName: "IMG_3279.jpeg",
    filePath: path.join(
      rootDirectory,
      "attached_assets/IMG_3279_1786045372175.jpeg",
    ),
    mediaType: "image/jpeg",
    expected: {
      documentType: "ticket",
      vendor: "Metro Green Recycling, LLC",
      ticketNumber: "1362560",
      invoiceNumber: "",
      purchaseOrder: "",
      jobNumber: "",
      // The printed date is fragmented ("7/2", "0", ",") across separate
      // OCR lines with no clean label next to it — reconstructing a full
      // date from that would be guessing, so it must stay blank.
      date: "",
      weight: "14.85 Tons",
      amount: "",
      description: "Concrete w/ Wire or Rebar",
      wasteCategory: "Inert",
    },
  },
  {
    fileName: "IMG_3280.jpeg",
    filePath: path.join(
      rootDirectory,
      "attached_assets/IMG_3280_1786045372175.jpeg",
    ),
    mediaType: "image/jpeg",
    expected: {
      documentType: "ticket",
      vendor: "Willow Oak Landfill",
      ticketNumber: "944952",
      invoiceNumber: "",
      purchaseOrder: "",
      jobNumber: "",
      date: "06/22/2026",
      weight: "4.49 Tons",
      amount: "$125.99",
      description: "2000T-C&D - Mixed",
      // Willow Oak isn't Metro Green or Vulcan Materials, so it defaults
      // to C&D — which also matches the ticket's own product description
      // ("2000T-C&D - Mixed").
      wasteCategory: "C&D",
    },
  },
  {
    fileName: "image_1786047436217.png",
    filePath: path.join(
      rootDirectory,
      "attached_assets/image_1786047436217.png",
    ),
    mediaType: "image/png",
    expected: {
      documentType: "invoice",
      vendor: "Metro Green Recycling Two, LLC",
      ticketNumber: "",
      invoiceNumber: "27530",
      purchaseOrder: "25-27458",
      jobNumber: "26-25-1325",
      date: "07/31/2026",
      weight: "",
      amount: "$5,600.00",
      description: "Concrete",
      wasteCategory: "Inert",
    },
  },
];

// Historical failure mode (see AUDIT.md C-1 / attached_assets/Pasted-The-
// previous-diagnostic-...txt): the generic fallback parser once treated a
// "Customer:" label as a vendor synonym and grabbed a column heading as a
// ticket number. Assert these specific wrong values can never recur, on
// every fixture, regardless of which extraction path handled it.
const neverGuessedValues = new Set([
  "872",
  "a",
  "Loads",
  "$ Line Tot",
  "s: 6",
  "5 i i",
  "Ticket Date",
  "LD% Qty UOM Rate",
]);

// Every /api route except /healthz and /auth/* sits behind the login gate
// (see AUDIT.md L-1) — authenticate once and reuse the session cookie.
const loginResponse = await fetch(`${apiUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: process.env.APP_LOGIN_USER,
    password: process.env.APP_LOGIN_PASSWORD,
  }),
});
assert.equal(loginResponse.status, 200, "login for regression test");
const sessionCookie = loginResponse.headers
  .get("set-cookie")
  ?.split(";")[0];
assert.ok(sessionCookie, "login response must set a session cookie");

for (const fixture of fixtures) {
  const imageData = (await readFile(fixture.filePath)).toString("base64");
  const response = await fetch(`${apiUrl}/api/tickets/extract`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({
      fileName: fixture.fileName,
      mediaType: fixture.mediaType,
      imageData,
    }),
  });

  assert.equal(response.status, 200, `${fixture.fileName} response status`);
  const actual = await response.json();

  for (const [field, value] of Object.entries(actual)) {
    assert.ok(
      !neverGuessedValues.has(value),
      `${fixture.fileName}: field "${field}" returned the known-bad guessed value ${JSON.stringify(value)}`,
    );
  }

  assert.deepEqual(actual, fixture.expected, fixture.fileName);
  console.log(`passed ${fixture.fileName}`);
}
