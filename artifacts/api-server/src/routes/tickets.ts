import { Router, type IRouter } from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ExtractTicketBody, ExtractTicketResponse } from "@workspace/api-zod";
import type { WasteCategory } from "@workspace/api-zod";
import { suggestCostCode } from "@workspace/cost-codes";
import { suggestDiversionMaterial } from "@workspace/diversion";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);
const IMAGE_PREPROCESS_TIMEOUT_MS = 20_000;
const OCR_TIMEOUT_MS = 8_000;
const OCR_MAX_DIMENSION = 2400;
const OCR_SCALE = "200%";
const OCR_THERMAL_SCALE = "300%";
const OCR_CONCURRENCY = 2;

type TicketFields = {
  documentType: "ticket" | "invoice";
  vendor: string;
  ticketNumber: string;
  invoiceNumber: string;
  purchaseOrder: string;
  jobNumber: string;
  date: string;
  weight: string;
  amount: string;
  description: string;
  // Only landfill/inert-landfill tickets get a C&D/Inert category; every
  // other ticket stays null ("N/A"), never auto-defaulted. See
  // classifyWasteCategory().
  wasteCategory: WasteCategory | null;
  // The PRIMARY classification (DHG's accounting "Cat" column) — see
  // suggestCostCode() below. Unlike wasteCategory, there is no safe
  // default: null means "needs manual review" and is never guessed.
  costCode: string | null;
  // LEED Waste & Scrap Diversion material — see suggestDiversionMaterial().
  // Independent of wasteCategory/costCode; null means "needs review" and is
  // never guessed.
  diversionMaterial: string | null;
};

const emptyFields: TicketFields = {
  documentType: "ticket",
  vendor: "",
  ticketNumber: "",
  invoiceNumber: "",
  purchaseOrder: "",
  jobNumber: "",
  date: "",
  weight: "",
  amount: "",
  description: "",
  // No auto-default: the waste C&D/Inert category is only meaningful for
  // landfill/inert-landfill tickets, so a fresh/unclassified ticket stays
  // null ("N/A" in the UI) until a landfill/inert vendor rule fires or the
  // user picks one. See classifyWasteCategory().
  wasteCategory: null,
  costCode: null,
  diversionMaterial: null,
};

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "image/gif") return ".gif";
  return ".jpg";
}

type OcrCandidate = {
  variant: string;
  psm: number;
  text: string;
  recognizedWords: number;
  averageConfidence: number;
  score: number;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type ImageVariantDefinition = {
  name: string;
  args: string[];
};

function isCommandTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const commandError = error as { killed?: unknown; code?: unknown };
  return commandError.killed === true || commandError.code === "ETIMEDOUT";
}

async function runCommand(
  command: string,
  args: string[],
  allowFailure = false,
  timeoutMs = OCR_TIMEOUT_MS,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        OMP_THREAD_LIMIT: "1",
        OMP_NUM_THREADS: "1",
      },
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (!allowFailure) throw error;
    const commandError = error as { stdout?: unknown; stderr?: unknown };
    return {
      stdout: typeof commandError.stdout === "string" ? commandError.stdout : "",
      stderr: typeof commandError.stderr === "string" ? commandError.stderr : "",
    };
  }
}

async function preprocessImage(
  imagePath: string,
  workingDirectory: string,
): Promise<{
  sourcePath: string;
  rotation: number;
  variantPaths: Array<{ name: string; path: string }>;
  fallbackDefinitions: ImageVariantDefinition[];
}> {
  const autoOrientedPath = path.join(workingDirectory, "auto-oriented.png");
  await runCommand("magick", [
    imagePath,
    "-auto-orient",
    "-resize",
    `${OCR_MAX_DIMENSION}x${OCR_MAX_DIMENSION}>`,
    autoOrientedPath,
  ], false, IMAGE_PREPROCESS_TIMEOUT_MS);

  const orientation = await runCommand(
    "tesseract",
    [autoOrientedPath, "stdout", "--psm", "0", "-l", "eng"],
    true,
    OCR_TIMEOUT_MS,
  );
  const rotationMatch = `${orientation.stdout}\n${orientation.stderr}`.match(
    /Rotate:\s*(0|90|180|270)/i,
  );
  const rotation = rotationMatch ? Number(rotationMatch[1]) : 0;
  const rotatedPath = path.join(workingDirectory, "rotation-corrected.png");
  const sourcePath = rotation
    ? rotatedPath
    : autoOrientedPath;

  if (rotation) {
    await runCommand("magick", [
      autoOrientedPath,
      "-rotate",
      String(rotation),
      rotatedPath,
    ], false, IMAGE_PREPROCESS_TIMEOUT_MS);
  }

  const variantDefinitions: ImageVariantDefinition[] = [
    {
      name: "enhanced",
      args: [
        "-resize",
        OCR_SCALE,
        "-resize",
        `${OCR_MAX_DIMENSION}x${OCR_MAX_DIMENSION}>`,
        "-colorspace",
        "Gray",
        "-contrast-stretch",
        "0x12%",
        "-unsharp",
        "0x1.2+1.0+0.02",
        "-despeckle",
        "-deskew",
        "40%",
        "-type",
        "Grayscale",
      ],
    },
    {
      name: "thermal",
      args: [
        "-resize",
        OCR_THERMAL_SCALE,
        "-resize",
        `${OCR_MAX_DIMENSION}x${OCR_MAX_DIMENSION}>`,
        "-colorspace",
        "Gray",
        "-statistic",
        "Median",
        "3x3",
        "-contrast-stretch",
        "1%x8%",
        "-unsharp",
        "0x1.0+1.0+0.02",
        "-despeckle",
        "-deskew",
        "40%",
        "-type",
        "Grayscale",
      ],
    },
    {
      name: "adaptive-threshold",
      args: [
        "-resize",
        OCR_SCALE,
        "-resize",
        `${OCR_MAX_DIMENSION}x${OCR_MAX_DIMENSION}>`,
        "-colorspace",
        "Gray",
        "-contrast-stretch",
        "0x12%",
        "-statistic",
        "Median",
        "3x3",
        // ImageMagick's local adaptive threshold is named -lat.
        "-lat",
        "41x41+10%",
        "-type",
        "Bilevel",
      ],
    },
  ];

  const simplePrimaryDefinition: ImageVariantDefinition = {
    name: "simple",
    args: [
      "-colorspace",
      "Gray",
      "-contrast-stretch",
      "0x8%",
      "-type",
      "Grayscale",
    ],
  };
  const primaryDefinition = variantDefinitions[0];
  const primaryPath = path.join(
    workingDirectory,
    `${primaryDefinition.name}.png`,
  );
  let selectedPrimaryVariant = primaryDefinition.name;
  try {
    await runCommand(
      "magick",
      [sourcePath, ...primaryDefinition.args, primaryPath],
      false,
      IMAGE_PREPROCESS_TIMEOUT_MS,
    );
  } catch (error) {
    if (!isCommandTimeout(error)) throw error;

    logger.warn(
      { timeoutMs: IMAGE_PREPROCESS_TIMEOUT_MS },
      "Primary OCR preprocessing timed out; retrying with simple profile",
    );
    selectedPrimaryVariant = simplePrimaryDefinition.name;
    await runCommand(
      "magick",
      [sourcePath, ...simplePrimaryDefinition.args, primaryPath],
      false,
      IMAGE_PREPROCESS_TIMEOUT_MS,
    );
  }

  return {
    sourcePath,
    rotation,
    variantPaths: [{ name: selectedPrimaryVariant, path: primaryPath }],
    fallbackDefinitions: variantDefinitions.slice(1),
  };
}

async function createFallbackVariants(
  sourcePath: string,
  workingDirectory: string,
  definitions: ImageVariantDefinition[],
): Promise<Array<{ name: string; path: string }>> {
  const variants: Array<{ name: string; path: string }> = [];
  for (const definition of definitions) {
    const variantPath = path.join(workingDirectory, `${definition.name}.png`);
    try {
      await runCommand(
        "magick",
        [sourcePath, ...definition.args, variantPath],
        false,
        IMAGE_PREPROCESS_TIMEOUT_MS,
      );
      variants.push({ name: definition.name, path: variantPath });
    } catch (error) {
      logger.warn(
        { err: error, variant: definition.name },
        "One OCR preprocessing variant failed",
      );
    }
  }
  return variants;
}

function candidateFromTsv(
  variant: string,
  psm: number,
  tsv: string,
): OcrCandidate {
  const groupedLines = new Map<string, string[]>();
  let recognizedWords = 0;
  let confidenceTotal = 0;

  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split("\t");
    if (columns.length < 12) continue;
    const text = columns[11]?.trim();
    const confidence = Number(columns[10]);
    if (!text || !Number.isFinite(confidence) || confidence < 0) continue;

    recognizedWords += 1;
    confidenceTotal += confidence;
    const lineKey = [columns[2], columns[3], columns[4]].join(":");
    const words = groupedLines.get(lineKey) ?? [];
    words.push(text);
    groupedLines.set(lineKey, words);
  }

  const text = Array.from(groupedLines.values())
    .map((words) => words.join(" "))
    .join("\n");
  const averageConfidence = recognizedWords
    ? confidenceTotal / recognizedWords
    : 0;
  const score =
    recognizedWords * 100 +
    Math.min(text.replace(/\s/g, "").length, 500) +
    averageConfidence;

  return {
    variant,
    psm,
    text,
    recognizedWords,
    averageConfidence,
    score,
  };
}

async function runOcrCandidate(
  variant: { name: string; path: string },
  psm: number,
): Promise<OcrCandidate> {
  try {
    const { stdout } = await runCommand("tesseract", [
      variant.path,
      "stdout",
      "--psm",
      String(psm),
      "-l",
      "eng",
      "--dpi",
      "300",
      "tsv",
    ]);
    return candidateFromTsv(variant.name, psm, stdout);
  } catch (error) {
    logger.warn(
      { err: error, variant: variant.name, psm },
      "One local OCR candidate failed",
    );
    return {
      variant: variant.name,
      psm,
      text: "",
      recognizedWords: 0,
      averageConfidence: 0,
      score: -1,
    };
  }
}

async function runOcrCandidates(
  variants: Array<{ name: string; path: string }>,
): Promise<OcrCandidate[]> {
  const jobs = variants.flatMap((variant) =>
    [4, 6, 11].map((psm) => ({ variant, psm })),
  );
  const results: OcrCandidate[] = [];
  let nextJob = 0;

  async function worker() {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob];
      nextJob += 1;
      results.push(await runOcrCandidate(job.variant, job.psm));
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(OCR_CONCURRENCY, jobs.length) },
      () => worker(),
    ),
  );
  return results;
}

async function runLocalOcr(
  imageData: string,
  mediaType: string,
): Promise<{
  text: string;
  alternateTexts: string[];
  variant: string;
  psm: number;
  rotation: number;
  candidates: OcrCandidate[];
}> {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "ticketyard-"));
  const imagePath = path.join(
    workingDirectory,
    `ticket${extensionForMediaType(mediaType)}`,
  );

  try {
    await writeFile(imagePath, Buffer.from(imageData, "base64"));
    const { rotation, variantPaths, fallbackDefinitions, sourcePath } =
      await preprocessImage(
      imagePath,
      workingDirectory,
      );
    const primaryCandidates = await runOcrCandidates(variantPaths.slice(0, 1));
    const primaryBest = primaryCandidates.reduce(
      (best, candidate) => (candidate.score > best.score ? candidate : best),
      primaryCandidates[0] ?? {
        variant: "enhanced",
        psm: 6,
        text: "",
        recognizedWords: 0,
        averageConfidence: 0,
        score: -1,
      },
    );
    const fallbackVariants =
      primaryBest.recognizedWords >= 5
        ? []
        : await createFallbackVariants(
            sourcePath,
            workingDirectory,
            fallbackDefinitions,
          );
    const fallbackCandidates = fallbackVariants.length
      ? await runOcrCandidates(fallbackVariants)
      : [];
    const candidates = [...primaryCandidates, ...fallbackCandidates].sort(
      (a, b) => b.score - a.score,
    );
    const best = candidates[0] ?? {
      text: "",
      variant: "none",
      psm: 6,
    };
    const alternateTexts = isMetroGreenInvoiceText(best.text)
      ? await runMetroGreenInvoiceDetailOcr(sourcePath, workingDirectory)
      : [];

    return {
      text: best.text,
      alternateTexts,
      variant: best.variant,
      psm: best.psm,
      rotation,
      candidates,
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function cleanOcrLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isFieldHeading(line: string): boolean {
  return /^(?:ticket(?:\s+(?:no|number|date|#|id))?|loads?|line\s+total|tax|qty|quantity|uom|rate|amount|material|description|product|origin|price|total(?:\s+(?:tax|ticket))?|customer|payment\s+type|manual\s+ticket|hauling\s+ticket|route|state\s+waste\s+code|manifest|destination|profile|generator|time|scale|operator|inbound|gross|tare|net|tons?)\b/i.test(
    line,
  );
}

function isMetroGreenLayout(text: string): boolean {
  // Match "Metro Green Recycling" tolerantly: OCR reliably gets "metro" and
  // "green" right, but "Recycling" is the word most often corrupted by
  // OCR noise, so match its first syllable loosely rather than requiring an
  // exact (or exactly-noisy) spelling. A regex requiring a non-letter
  // between "re" and "yc" can never match a cleanly OCR'd "Recycling" —
  // that was the bug: it only matched runs where OCR had already corrupted
  // the word, so a clean OCR pass of the same ticket failed layout
  // detection entirely and fell through to the generic (unsafe) parser.
  return (
    /metro/i.test(text) &&
    /green/i.test(text) &&
    /re\s*c?\s*y\s*c/i.test(text)
  );
}

function isWillowOakLayout(text: string): boolean {
  return /willow\s+oak\s+landfill/i.test(text);
}

function isMetroGreenInvoiceText(text: string): boolean {
  return (
    /metro\s+green\s+recycling\s+two/i.test(text) &&
    /\binvoice\b/i.test(text)
  );
}

async function runMetroGreenInvoiceDetailOcr(
  sourcePath: string,
  workingDirectory: string,
): Promise<string[]> {
  const identify = await runCommand(
    "identify",
    ["-format", "%w %h", sourcePath],
    false,
    OCR_TIMEOUT_MS,
  );
  const [width, height] = identify.stdout
    .trim()
    .split(/\s+/)
    .map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return [];

  const crops = [
    {
      name: "invoice-accounting",
      width: Math.round(width * 0.46),
      height: Math.round(height * 0.18),
      x: 0,
      y: Math.round(height * 0.71),
    },
    {
      name: "invoice-header",
      width: Math.round(width * 0.22),
      height: Math.round(height * 0.12),
      x: Math.round(width * 0.26),
      y: Math.round(height * 0.075),
    },
  ];

  const texts: string[] = [];
  for (const crop of crops) {
    const cropPath = path.join(workingDirectory, `${crop.name}.png`);
    try {
      await runCommand(
        "magick",
        [
          sourcePath,
          "-crop",
          `${crop.width}x${crop.height}+${crop.x}+${crop.y}`,
          "+repage",
          "-resize",
          "800%",
          "-colorspace",
          "Gray",
          "-contrast-stretch",
          "0x18%",
          "-unsharp",
          "0x1.5+1.0+0.02",
          cropPath,
        ],
        false,
        IMAGE_PREPROCESS_TIMEOUT_MS,
      );
      for (const psm of [6, 11]) {
        const { stdout } = await runCommand(
          "tesseract",
          [cropPath, "stdout", "--psm", String(psm), "-l", "eng"],
          true,
          OCR_TIMEOUT_MS,
        );
        if (stdout.trim()) texts.push(stdout);
      }
    } catch (error) {
      logger.warn(
        { err: error, crop: crop.name },
        "Metro Green invoice detail OCR crop failed",
      );
    }
  }
  return texts;
}

function normalizedLayoutText(text: string): string {
  return text.replace(/&amp;/gi, "&").replace(/\r?\n/g, " ");
}

function valueFromLine(lines: string[], pattern: RegExp): string {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;

    const inlineValue = match[1]?.trim().replace(/^[:#-]\s*/, "");
    if (inlineValue && !isFieldHeading(inlineValue)) return inlineValue;
    const nextLine = lines[index + 1]?.trim();
    if (
      nextLine &&
      !isFieldHeading(nextLine) &&
      !/^[A-Z][A-Z\s#-]{2,}:/.test(nextLine)
    ) {
      return nextLine;
    }
  }
  return "";
}

function firstMatch(lines: string[], pattern: RegExp): string {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[0] && !isFieldHeading(match[0].trim())) {
      return match[0].trim();
    }
  }
  return "";
}

function looksLikeDocumentHeading(line: string): boolean {
  return isFieldHeading(line);
}

// D.H. Griffin tracks disposal cost, hauling cost, billing, and
// profitability separately for C&D landfill vs. inert/concrete recycling —
// the two must never be merged anywhere downstream. The C&D/Inert category
// is ONLY meaningful for landfill / inert-landfill tickets, so this
// classifier deliberately does NOT default to "C&D": it returns a category
// only for a confidently-recognized landfill/disposal/recycling vendor and
// null ("N/A" / needs review) otherwise. Deterministic vendor rule, never
// AI / OCR-text guessing; always user-overridable in the UI.
export function classifyWasteCategory(vendor: string): WasteCategory | null {
  const normalizedVendor = vendor.replace(/\s+/g, " ").trim();
  if (!normalizedVendor) return null;
  // Inert / concrete-recycling vendors.
  if (/metro\s+green/i.test(normalizedVendor)) return "Inert";
  // Was previously mistyped as "volk and materials" and could never
  // match any real vendor name — Vulcan Materials is inert (concrete).
  if (/vulcan\s+materials/i.test(normalizedVendor)) return "Inert";
  // C&D landfill / general disposal vendors.
  if (/landfill|disposal|waste\s+management|\bwm\b/i.test(normalizedVendor)) return "C&D";
  if (/willow\s+oak/i.test(normalizedVendor)) return "C&D";
  // Not a landfill/inert ticket — leave the category blank ("N/A").
  return null;
}

// The functions below implement per-vendor *layout* rules (this ticket
// format always prints X near label Y), not per-fixture *value* rules.
// None of them may match against a specific known-good literal — every
// captured value must come from a label or an unambiguous positional/shape
// anchor that holds for any ticket from that vendor, not just the ones
// this codebase happens to have been tested against. When nothing on the
// page satisfies that anchor, the field is left blank.

/** A decimal figure immediately followed by "Tons"/"Ton" — Gross/Tare/Net
 * weigh figures on these tickets are plain numbers, so a number directly
 * tagged "Tons" reliably identifies the net weight line without needing to
 * know its value in advance. */
function extractTonsWeight(normalized: string): string {
  const match = normalized.match(/\b(\d{1,3}(?:,\d{3})?\.\d{1,2})\s+tons?\b/i);
  return match ? `${match[1]} Tons` : "";
}

function parseMetroGreenFields(text: string): Partial<TicketFields> {
  const normalized = normalizedLayoutText(text);

  // The printed ticket ID is a bare 7-8 digit number starting with "1"
  // (Gross/Tare/Net/Order Number figures on this layout never take that
  // shape). Only trust it when exactly one such candidate appears — if OCR
  // produced more than one, we can't tell which is the real ticket number
  // without guessing, so leave it blank.
  const ticketCandidates = [...new Set(normalized.match(/\b1\d{6,7}\b/g) ?? [])];
  const ticketNumber = ticketCandidates.length === 1 ? ticketCandidates[0] : "";

  // "Ticket Date" (or similarly labeled) is not reliably printed on this
  // layout's header in a clean, unfragmented way; rather than reconstruct a
  // date from fragmented OCR tokens, only accept a fully-formed date next
  // to an explicit label.
  const date =
    normalized.match(/ticket\s+date\s*[:#-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
      ?.[1] ?? "";

  const weight = extractTonsWeight(normalized);

  // Only recognize material descriptions from a short, explicit keyword
  // list — this stays deterministic (no AI, no free-text OCR guessing)
  // while covering the common C&D material types this vendor handles.
  // Anything not on the list, or fragmented by OCR (e.g. an ellipsis before
  // a plausible next word), is left blank rather than reconstructed.
  let description = "";
  if (/concrete/i.test(normalized) && /wire|rebar/i.test(normalized)) {
    description = "Concrete w/ Wire or Rebar";
  } else if (/clean\s+concrete/i.test(normalized)) {
    description = "Clean Concrete";
  } else if (/concrete/i.test(normalized)) {
    description = "Concrete";
  } else if (/asphalt/i.test(normalized)) {
    description = "Asphalt";
  }

  return {
    documentType: "ticket",
    vendor: "Metro Green Recycling, LLC",
    ticketNumber,
    date,
    weight,
    amount: "",
    description,
  };
}

function parseMetroGreenInvoiceFields(text: string): Partial<TicketFields> {
  const normalized = normalizedLayoutText(text);
  const lines = cleanOcrLines(text);

  // This vendor's invoices print an accounting-system row with columns
  // "Vendor  Invoice  Purchase Order  Inv Date  Amount  Tax ...". Restrict
  // invoice/PO/date extraction to the row right after that header (rather
  // than scanning the whole page for a number of roughly the right shape,
  // which can accidentally grab an unrelated number — e.g. a zip code
  // matches "5 digits" just as well as a real invoice number). The header
  // is re-OCR'd from several image variants/crops, so it can appear more
  // than once with different neighboring lines — try each occurrence and
  // use the first one whose following row actually contains data.
  let invoiceNumber = "";
  let purchaseOrder = "";
  let date = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!(/vendor/i.test(line) && /invoice/i.test(line) && /purchase/i.test(line))) continue;

    const row = lines.slice(i + 1, i + 3).join(" ");
    const inv = row.match(/\b(\d{5})\b/)?.[1];
    const po = row.match(/\b(\d{2}-\d{4,6})\b/)?.[1];
    if (!inv && !po) continue;

    invoiceNumber = inv ?? "";
    purchaseOrder = po ?? "";
    const dateMatch = row.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    date = dateMatch ? dateMatch.slice(1).join("/") : "";
    break;
  }

  // The job number is not printed with its own clean label on this layout —
  // it appears as a bare "##-##-####" token in the accounting-summary
  // section. That shape is ambiguous with a date written the same way
  // (e.g. "07-31-2026"), so only trust it when the identical token is
  // printed more than once (this layout repeats the job number at both the
  // start and end of its summary row); a token seen only once could just
  // as easily be the date, so it's left blank rather than guessed.
  const dashTokenCounts = new Map<string, number>();
  for (const match of normalized.matchAll(/\b(\d{2}-\d{2}-\d{4})\b/g)) {
    dashTokenCounts.set(match[1], (dashTokenCounts.get(match[1]) ?? 0) + 1);
  }
  const jobNumber =
    [...dashTokenCounts.entries()].find(([, count]) => count >= 2)?.[0] ?? "";

  // Combined multi-page invoices should use the accounting-system total,
  // not an arithmetic sum of the individual line items on any one page.
  const totalMatch =
    normalized.match(/invoice\s+total\s+\$?\s*([\d,]+\.\d{2})/i) ??
    normalized.match(/\btotal\s+([\d,]+\.\d{2})\b/i) ??
    normalized.match(/\bamount\s+tax\s+discount\s+[\w~.-]*\s+([\d,]+\.\d{2})\b/i);

  let description = "";
  if (/clean\s+concrete/i.test(normalized)) {
    description = "Clean Concrete";
  } else if (/concrete/i.test(normalized)) {
    description = "Concrete";
  }

  return {
    documentType: "invoice",
    vendor: "Metro Green Recycling Two, LLC",
    ticketNumber: "",
    invoiceNumber,
    purchaseOrder,
    jobNumber,
    date,
    weight: "",
    amount: totalMatch ? `$${totalMatch[1]}` : "",
    description,
  };
}

function parseWillowOakFields(text: string): Partial<TicketFields> {
  const normalized = normalizedLayoutText(text);
  // Line-based scans must run against the original (newline-preserving)
  // text — normalizedLayoutText() collapses all newlines into spaces, so
  // cleanOcrLines(normalized) would return the whole document as one line.
  const lines = cleanOcrLines(text);

  // This layout's ticket number is printed in the header block (near the
  // facility name/address/phone) before the "Customer Name" line, without
  // a clean OCR'd label of its own. Anchor on that header region instead
  // of the value: a lone 5-7 digit token appearing before "Customer Name".
  const customerNameIndex = lines.findIndex((line) => /customer\s*name/i.test(line));
  const headerLines = customerNameIndex >= 0 ? lines.slice(0, customerNameIndex) : lines.slice(0, 6);
  let ticketNumber = "";
  for (const line of headerLines) {
    const match = line.match(/\b(\d{5,7})\b/);
    if (match) {
      ticketNumber = match[1];
      break;
    }
  }

  const date =
    normalized.match(/ticket\s+date\s*[:#-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1] ?? "";

  const weight = extractTonsWeight(normalized);

  // Product/material codes on this layout look like "2000T-C&D - Mixed":
  // a numeric code, "T-", then a material label. Capture that shape
  // generically instead of one hardcoded product string.
  const productMatch = normalized.match(
    /\b(\d{3,5}T-[A-Z0-9&]+(?:\s*-\s*[A-Za-z]+)?)\b/i,
  );

  // The product/line-item row prints "<tax> $<amount>" (e.g. "7.86
  // $118.13"); the ticket total is tax + line amount. Capture both figures
  // generically rather than requiring their exact values.
  const taxAndLineAmount = normalized.match(/\b(\d{1,4}\.\d{2})\s+\$(\d{1,6}\.\d{2})\b/);
  const amount = taxAndLineAmount
    ? `$${(Number(taxAndLineAmount[1]) + Number(taxAndLineAmount[2])).toFixed(2)}`
    : "";

  return {
    documentType: "ticket",
    vendor: "Willow Oak Landfill",
    ticketNumber,
    date,
    weight,
    amount,
    description: productMatch
      ? productMatch[1].replace(/\s+/g, " ")
      : "",
  };
}

function parseTicketNumber(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(
      /^ticket\s*(?:no|number|#|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]*)$/i,
    );
    if (match?.[1] && !isFieldHeading(match[1])) return match[1];
  }
  return "";
}

function parseDate(lines: string[]): string {
  // Only accept dates that appear next to an explicit label.
  // Returning the first date-shaped token found anywhere is a guess and is not allowed.
  for (const line of lines) {
    const match = line.match(
      /^(?:ticket\s+)?date\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/i,
    );
    if (match?.[1]) return match[1];
  }
  return "";
}

function parseAmount(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(
      /(?:^|\s)(\$\s*\d[\d,.]*(?:\.\d{2})?)(?:\s|$)/,
    );
    if (match?.[1]) return match[1].replace(/\s+/g, "");
  }
  return "";
}

function parseOcrText(text: string, alternateTexts: string[] = []): TicketFields {
  const lines = cleanOcrLines(text);
  if (!lines.length) return emptyFields;
  const combinedText = [text, ...alternateTexts]
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index)
    .join("\n");
  const combinedLines = cleanOcrLines(combinedText);
  const metroFields = isMetroGreenLayout(combinedText)
    ? parseMetroGreenFields(combinedText)
    : {};
  const willowFields = isWillowOakLayout(combinedText)
    ? parseWillowOakFields(combinedText)
    : {};
  const metroInvoiceFields = isMetroGreenInvoiceText(combinedText)
    ? parseMetroGreenInvoiceFields(combinedText)
    : {};

  if (
    Object.keys(metroInvoiceFields).length ||
    Object.keys(metroFields).length ||
    Object.keys(willowFields).length
  ) {
    const layoutFields = {
      ...metroFields,
      ...willowFields,
      ...metroInvoiceFields,
    };
    return ExtractTicketResponse.parse({
      ...emptyFields,
      ...layoutFields,
      wasteCategory: classifyWasteCategory(layoutFields.vendor ?? ""),
      costCode: suggestCostCode(layoutFields.vendor, layoutFields.description),
      diversionMaterial: suggestDiversionMaterial(layoutFields.vendor),
    });
  }

  // Generic (unrecognized layout) fallback path.
  // Rule: only accept values that appear next to an explicit label.
  // Do NOT guess based on nearby text, all-caps lines, or the first matching
  // token found anywhere in the OCR output. A blank field is always better
  // than an incorrect one — the user can edit it.
  // "Customer" is deliberately excluded: on real tickets it names the
  // receiving/billed company (e.g. "Customer: D.H. Griffin"), not the
  // hauler/vendor who issued the ticket — treating it as a vendor synonym
  // previously caused confident, wrong (non-blank) vendor values.
  const vendor =
    valueFromLine(
      lines,
      /^(?:vendor|company|hauler|supplier|facility|from)\s*[:#-]?\s*(.*)$/i,
    ) || "";

  const ticketNumber =
    parseTicketNumber(lines) ||
    valueFromLine(
      lines,
      /^(?:ticket\s*(?:no|number|#|id)|ticket\s*#)\s*[:#-]?\s*(.*)$/i,
    ) ||
    "";
  const invoiceNumber = "";
  const purchaseOrder = "";
  const jobNumber = "";

  const date =
    parseDate(lines) ||
    valueFromLine(
      lines,
      /^(?:ticket\s+)?date\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/i,
    ) ||
    "";

  // Weight: only accept values next to an explicit weight label.
  // Do NOT scan for bare unit tokens (e.g. "14.85 Tons") without a label —
  // those could be table cells, subtotals, or other numeric rows.
  const weight =
    valueFromLine(
      lines,
      /^(?:(?:net|gross|tare)\s+)?weight(?:\s+(?:lbs?|pounds?|tons?|tonnes?|kg|yards?))?\s*[:#-]?\s*(.*)$/i,
    ) || "";

  // Amount: only accept a value next to an explicit total/amount label.
  // Do NOT grab the first "$" token found anywhere — that could be a line item,
  // a unit price, a tax cell, or any other incidental dollar figure.
  const amount =
    valueFromLine(
      lines,
      /^(?:(?:total|net)\s+)?(?:amount|charge|price|due|cost|total)\s*[:#-]?\s*(\$?\s*\d[\d,.]*(?:\.\d{2})?)$/i,
    ) || "";

  const description =
    valueFromLine(
      lines,
      /^(?:description|material|materials|load|contents|waste\s+type|product)\s*[:#-]?\s*(.*)$/i,
    ) || "";
  const wasteCategory = classifyWasteCategory(vendor);
  const costCode = suggestCostCode(vendor, description);
  const diversionMaterial = suggestDiversionMaterial(vendor);

  return ExtractTicketResponse.parse({
    ...emptyFields,
    documentType: "ticket",
    vendor,
    ticketNumber,
    invoiceNumber,
    purchaseOrder,
    jobNumber,
    date,
    weight,
    amount,
    description,
    wasteCategory,
    costCode,
    diversionMaterial,
  });
}

router.post("/tickets/extract", async (req, res) => {
  const parsedBody = ExtractTicketBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Please provide a supported ticket image." });
    return;
  }

  const { fileName, mediaType, imageData } = parsedBody.data;

  try {
    logger.info(
      {
        fileName,
        mediaType,
        imageBytesBase64: imageData.length,
        ocrEngine: "tesseract",
      },
      "Starting local ticket OCR",
    );

    const ocrResult = await runLocalOcr(imageData, mediaType);
    const ocrText = ocrResult.text;
    logger.info(
      {
        fileName,
        rotation: ocrResult.rotation,
        selectedVariant: ocrResult.variant,
        selectedPsm: ocrResult.psm,
        candidates: ocrResult.candidates.map((candidate) => ({
          variant: candidate.variant,
          psm: candidate.psm,
          recognizedWords: candidate.recognizedWords,
          averageConfidence: Math.round(candidate.averageConfidence * 10) / 10,
          score: Math.round(candidate.score * 10) / 10,
        })),
      },
      "Local OCR preprocessing and candidate selection",
    );
    logger.info(
      {
        fileName,
        rawOcrText: ocrText,
        alternateTexts: ocrResult.alternateTexts,
      },
      "Raw OCR text before ticket field parsing",
    );
    const extraction = parseOcrText(ocrText, ocrResult.alternateTexts);

    logger.info(
      {
        fileName,
        ocrCharacters: ocrText.length,
        fieldsFound: Object.values(extraction).filter(Boolean).length,
      },
      "Local ticket OCR completed",
    );

    if (!ocrText.trim()) {
      res.status(422).json({
        error:
          "No readable text was found in this image. Try a sharper, brighter ticket photo.",
      });
      return;
    }

    res.json(extraction);
  } catch (error) {
    logger.error({ err: error, fileName }, "Local ticket OCR failed");
    res.status(502).json({
      error:
        "The local OCR reader could not process this image. Try a JPG or PNG ticket photo.",
    });
  }
});

export default router;