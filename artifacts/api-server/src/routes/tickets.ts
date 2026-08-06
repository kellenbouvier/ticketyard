import { Router, type IRouter } from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ExtractTicketBody, ExtractTicketResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);
const IMAGE_PREPROCESS_TIMEOUT_MS = 20_000;
const OCR_TIMEOUT_MS = 8_000;
const OCR_SCALE = "200%";
const OCR_THERMAL_SCALE = "300%";
const OCR_CONCURRENCY = 2;

type TicketFields = {
  vendor: string;
  ticketNumber: string;
  date: string;
  weight: string;
  amount: string;
  description: string;
};

const emptyFields: TicketFields = {
  vendor: "",
  ticketNumber: "",
  date: "",
  weight: "",
  amount: "",
  description: "",
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

  const primaryDefinition = variantDefinitions[0];
  const primaryPath = path.join(
    workingDirectory,
    `${primaryDefinition.name}.png`,
  );
  await runCommand(
    "magick",
    [sourcePath, ...primaryDefinition.args, primaryPath],
    false,
    IMAGE_PREPROCESS_TIMEOUT_MS,
  );

  return {
    sourcePath,
    rotation,
    variantPaths: [{ name: primaryDefinition.name, path: primaryPath }],
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
): Promise<{ text: string; variant: string; psm: number; rotation: number; candidates: OcrCandidate[] }> {
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

    return {
      text: best.text,
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

function valueFromLine(lines: string[], pattern: RegExp): string {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;

    const inlineValue = match[1]?.trim().replace(/^[:#-]\s*/, "");
    if (inlineValue) return inlineValue;
    const nextLine = lines[index + 1]?.trim();
    if (nextLine && !/^[A-Z][A-Z\s#-]{2,}:/.test(nextLine)) {
      return nextLine;
    }
  }
  return "";
}

function firstMatch(lines: string[], pattern: RegExp): string {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return "";
}

function looksLikeDocumentHeading(line: string): boolean {
  return /^(?:ticket|weighmaster|scale|date|weight|net|total|amount|description|material|load|customer|vendor|hauler)\b/i.test(
    line,
  );
}

function parseOcrText(text: string): TicketFields {
  const lines = cleanOcrLines(text);
  if (!lines.length) return emptyFields;

  const vendor =
    valueFromLine(
      lines,
      /^(?:vendor|company|hauler|supplier|facility|customer|from)\s*[:#-]?\s*(.*)$/i,
    ) ||
    lines.find(
      (line) =>
        line.length >= 3 &&
        !looksLikeDocumentHeading(line) &&
        !/^\d[\d\s./-]*$/.test(line),
    ) ||
    "";

  const ticketNumber =
    valueFromLine(
      lines,
      /^(?:ticket\s*(?:no|number|#|id)|ticket\s*#)\s*[:#-]?\s*(.*)$/i,
    ) ||
    firstMatch(lines, /(?:ticket|load|manifest|reference)\s*(?:no|number|#|id)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9-]*/i);

  const date =
    valueFromLine(
      lines,
      /^(?:ticket\s+)?date\s*[:#-]?\s*(.*)$/i,
    ) ||
    firstMatch(
      lines,
      /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/i,
    );

  const weight =
    valueFromLine(
      lines,
      /^(?:(?:net|gross|tare)\s+)?weight(?:\s+(?:lbs?|pounds?|tons?|tonnes?|kg|yards?))?\s*[:#-]?\s*(.*)$/i,
    ) ||
    firstMatch(
      lines,
      /\b\d[\d,.]*\s*(?:tons?|tonnes?|lbs?|pounds?|kg|yds?|yards?)\b/i,
    );

  const amount =
    valueFromLine(
      lines,
      /^(?:(?:total|net)\s+)?(?:amount|charge|price|due|cost|total)\s*[:#-]?\s*(.*)$/i,
    ) ||
    firstMatch(lines, /\$\s*\d[\d,.]*(?:\.\d{2})?|\b(?:total|amount|due)\s*[:#-]?\s*\d[\d,.]*(?:\.\d{2})?/i);

  const description =
    valueFromLine(
      lines,
      /^(?:description|material|materials|load|contents|waste\s+type|product)\s*[:#-]?\s*(.*)$/i,
    ) || "";

  return ExtractTicketResponse.parse({
    ...emptyFields,
    vendor,
    ticketNumber,
    date,
    weight,
    amount,
    description,
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
      },
      "Raw OCR text before ticket field parsing",
    );
    const extraction = parseOcrText(ocrText);

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