import { Router, type IRouter } from "express";
import { ExtractTicketBody, ExtractTicketResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const extractionPrompt = `You are extracting data from construction-industry paperwork.
Read the provided ticket, receipt, scale ticket, weigh ticket, landfill ticket, transfer
station ticket, demolition ticket, trucking ticket, hauling ticket, material delivery,
scrap yard, metal recycling, Home Depot, Lowe's, or Supply House receipt.

Return ONLY one JSON object with exactly these string fields:
{"vendor":"","ticketNumber":"","date":"","weight":"","amount":"","description":""}

Copy values only when they are visibly present and readable. If a field is missing,
unclear, or ambiguous, return an empty string for that field. Never infer, estimate,
normalize, or hallucinate a value. Preserve the document's visible formatting for
dates, weights, and amounts where practical. No markdown, explanation, or code fences.`;

function extractTextContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function parseExtraction(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error("Claude did not return a JSON object");
  }

  const parsed: unknown = JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
  return ExtractTicketResponse.parse({
    vendor:
      typeof (parsed as Record<string, unknown>).vendor === "string"
        ? (parsed as Record<string, string>).vendor
        : "",
    ticketNumber:
      typeof (parsed as Record<string, unknown>).ticketNumber === "string"
        ? (parsed as Record<string, string>).ticketNumber
        : "",
    date:
      typeof (parsed as Record<string, unknown>).date === "string"
        ? (parsed as Record<string, string>).date
        : "",
    weight:
      typeof (parsed as Record<string, unknown>).weight === "string"
        ? (parsed as Record<string, string>).weight
        : "",
    amount:
      typeof (parsed as Record<string, unknown>).amount === "string"
        ? (parsed as Record<string, string>).amount
        : "",
    description:
      typeof (parsed as Record<string, unknown>).description === "string"
        ? (parsed as Record<string, string>).description
        : "",
  });
}

router.post("/tickets/extract", async (req, res) => {
  const parsedBody = ExtractTicketBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Please provide a supported ticket image." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res
      .status(503)
      .json({ error: "Ticket extraction is not configured on the server." });
    return;
  }

  const { fileName, mediaType, imageData } = parsedBody.data;

  try {
    logger.info(
      {
        fileName,
        mediaType,
        imageBytesBase64: imageData.length,
        apiKeyConfigured: Boolean(apiKey),
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      },
      "Starting Anthropic ticket extraction",
    );
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 8192,
        system: extractionPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageData },
              },
              {
                type: "text",
                text: `Extract the six fields from this ticket image. The source file is "${fileName}".`,
              },
            ],
          },
        ],
      }),
    });

    const responseText = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { raw: responseText };
    }
    if (!response.ok) {
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          fileName,
          anthropicError: payload,
        },
        "Anthropic ticket extraction failed",
      );
      const providerMessage =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        payload.error &&
        typeof payload.error === "object" &&
        "message" in payload.error &&
        typeof payload.error.message === "string"
          ? payload.error.message
          : "The ticket could not be read. Please retry.";
      const isCreditError =
        providerMessage.toLowerCase().includes("credit balance") ||
        providerMessage.toLowerCase().includes("purchase credits");
      res.status(isCreditError ? 402 : 502).json({ error: providerMessage });
      return;
    }

    const result = parseExtraction(extractTextContent(payload));
    res.json(result);
  } catch (error) {
    logger.error({ err: error, fileName }, "Ticket extraction request failed");
    res.status(502).json({ error: "The ticket could not be read. Please retry." });
  }
});

export default router;