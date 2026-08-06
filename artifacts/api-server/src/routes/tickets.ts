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
const OCR_TIMEOUT_MS = 45_000;

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

async function runLocalOcr(
  imageData: string,
  mediaType: string,
): Promise<string> {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "ticketyard-"));
  const imagePath = path.join(
    workingDirectory,
    `ticket${extensionForMediaType(mediaType)}`,
  );

  try {
    await writeFile(imagePath, Buffer.from(imageData, "base64"));
    const { stdout } = await execFileAsync(
      "tesseract",
      [imagePath, "stdout", "--psm", "6"],
      {
        timeout: OCR_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return stdout;
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

    const ocrText = await runLocalOcr(imageData, mediaType);
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