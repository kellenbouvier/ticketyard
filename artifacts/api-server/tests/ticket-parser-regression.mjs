import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const apiUrl = process.env.TICKETYARD_API_URL ?? "http://127.0.0.1:8080";

const fixtures = [
  {
    fileName: "IMG_3279.jpeg",
    filePath: path.join(
      rootDirectory,
      "attached_assets/IMG_3279_1786045372175.jpeg",
    ),
    expected: {
      documentType: "ticket",
      vendor: "Metro Green Recycling, LLC",
      ticketNumber: "1362560",
      invoiceNumber: "",
      purchaseOrder: "",
      jobNumber: "",
      date: "07/02/2026",
      weight: "14.85 Tons",
      amount: "",
      description: "Concrete w/ Wire or Rebar",
      wasteType: "Inert Landfill",
    },
  },
  {
    fileName: "IMG_3280.jpeg",
    filePath: path.join(
      rootDirectory,
      "attached_assets/IMG_3280_1786045372175.jpeg",
    ),
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
      wasteType: "Landfill",
    },
  },
  {
    fileName: "image_1786047436217.png",
    filePath: path.join(
      rootDirectory,
      "attached_assets/image_1786047436217.png",
    ),
    expected: {
      documentType: "invoice",
      vendor: "Metro Green Recycling Two, LLC",
      ticketNumber: "",
      invoiceNumber: "27530",
      purchaseOrder: "25-21458",
      jobNumber: "26-25-1325",
      date: "07/31/2026",
      weight: "",
      amount: "$5,600.00",
      description: "Clean Concrete",
      wasteType: "Inert Landfill",
    },
  },
];

for (const fixture of fixtures) {
  const imageData = (await readFile(fixture.filePath)).toString("base64");
  const response = await fetch(`${apiUrl}/api/tickets/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: fixture.fileName,
      mediaType: "image/jpeg",
      imageData,
    }),
  });

  assert.equal(response.status, 200, `${fixture.fileName} response status`);
  const actual = await response.json();
  assert.deepEqual(actual, fixture.expected, fixture.fileName);
  console.log(`passed ${fixture.fileName}`);
}