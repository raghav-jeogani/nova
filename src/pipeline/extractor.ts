import OpenAI from "openai";
import { pdf } from "pdf-to-img";
import {
  extractionOutputSchema,
  type ExtractionOutput,
  EXTRACTION_JSON_SCHEMA,
} from "../contracts/extraction.js";

const MAX_PDF_PAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type ExtractorResult = {
  extraction: ExtractionOutput;
  rawModelJson: string;
  estimatedCostUsd: number;
};

const SYSTEM_PROMPT = `You are a trade document extraction agent. Read the shipping/commercial document image(s) and extract the following fields. For each field return an object with "value" (string or null if truly absent/unreadable) and "confidence" between 0 and 1. Never invent values: if unsure, use null and low confidence. Normalize: trim whitespace; HS code as digits with optional dots; Incoterms like FOB, CIF in uppercase.`;

function estimateVisionCostUsd(inputTokensApprox: number, outputTokensApprox: number): number {
  const inPrice = 2.5 / 1e6;
  const outPrice = 10 / 1e6;
  return inputTokensApprox * inPrice + outputTokensApprox * outPrice;
}

async function bufferToDataUrl(mime: string, buf: Buffer): Promise<string> {
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function pdfBuffersToDataUrls(pdfBuffer: Buffer): Promise<string[]> {
  const urls: string[] = [];
  let page = 0;
  const iterable = await pdf(pdfBuffer, { scale: 1.2 });
  for await (const pageImage of iterable) {
    page += 1;
    if (page > MAX_PDF_PAGES) break;
    const buf = Buffer.isBuffer(pageImage) ? pageImage : Buffer.from(pageImage);
    urls.push(await bufferToDataUrl("image/png", buf));
  }
  if (urls.length === 0) {
    throw new Error("PDF produced no renderable pages");
  }
  return urls;
}

export async function extractFromDocument(
  openai: OpenAI,
  input: { buffer: Buffer; mime: string; filename: string }
): Promise<ExtractorResult> {
  const mime = input.mime.toLowerCase();
  let imageUrls: string[];

  if (mime === "application/pdf" || input.filename.toLowerCase().endsWith(".pdf")) {
    imageUrls = await pdfBuffersToDataUrls(input.buffer);
  } else if (mime.startsWith("image/")) {
    if (input.buffer.length > MAX_IMAGE_BYTES) {
      throw new Error("Image exceeds maximum size (4MB)");
    }
    imageUrls = [await bufferToDataUrl(mime, input.buffer)];
  } else {
    throw new Error(`Unsupported mime type for extraction: ${mime}`);
  }

  const schemaBody = { ...EXTRACTION_JSON_SCHEMA } as Record<string, unknown>;
  delete schemaBody.$schema;
  const jsonSchema = {
    name: "trade_extraction",
    strict: true as const,
    schema: schemaBody,
  };

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `Extract structured trade fields from this document (filename: ${input.filename}).`,
    },
    ...imageUrls.map(
      (url): OpenAI.Chat.ChatCompletionContentPart => ({
        type: "image_url",
        image_url: { url, detail: "high" },
      })
    ),
  ];

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
    max_tokens: 2048,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_schema", json_schema: jsonSchema },
  });

  const choice = completion.choices[0]?.message?.content;
  if (!choice) {
    throw new Error("Empty completion from vision model");
  }

  const parsed = extractionOutputSchema.parse(JSON.parse(choice));
  const usage = completion.usage;
  const inTok = usage?.prompt_tokens ?? 2500 * imageUrls.length;
  const outTok = usage?.completion_tokens ?? 400;
  const estimatedCostUsd = estimateVisionCostUsd(inTok, outTok);

  return {
    extraction: parsed,
    rawModelJson: choice,
    estimatedCostUsd,
  };
}
