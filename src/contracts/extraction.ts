import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** One trade field with model-estimated confidence (0–1). */
export const extractionFieldSchema = z.object({
  value: z.string().nullable().describe("Extracted text or null if absent/unreadable"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Model confidence 0–1 for this field"),
});

export type ExtractionField = z.infer<typeof extractionFieldSchema>;

export const extractionOutputSchema = z.object({
  consigneeName: extractionFieldSchema,
  hsCode: extractionFieldSchema,
  portOfLoading: extractionFieldSchema,
  portOfDischarge: extractionFieldSchema,
  incoterms: extractionFieldSchema,
  descriptionOfGoods: extractionFieldSchema,
  grossWeight: extractionFieldSchema,
  invoiceNumber: extractionFieldSchema,
});

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

/** Inline JSON Schema root (no $ref) for OpenAI `response_format.json_schema`. */
export const EXTRACTION_JSON_SCHEMA = zodToJsonSchema(extractionOutputSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;
