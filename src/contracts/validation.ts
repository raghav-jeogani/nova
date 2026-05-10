import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const validationStatusSchema = z.enum(["match", "mismatch", "uncertain"]);

export type ValidationStatus = z.infer<typeof validationStatusSchema>;

export const tradeFieldKeySchema = z.enum([
  "consigneeName",
  "hsCode",
  "portOfLoading",
  "portOfDischarge",
  "incoterms",
  "descriptionOfGoods",
  "grossWeight",
  "invoiceNumber",
]);

export type TradeFieldKey = z.infer<typeof tradeFieldKeySchema>;

export const fieldValidationRowSchema = z.object({
  field: tradeFieldKeySchema,
  status: validationStatusSchema,
  /** Present when status is mismatch */
  found: z.string().nullable().optional(),
  /** Present when status is mismatch or uncertain (expected rule / norm) */
  expected: z.string().nullable().optional(),
  notes: z.string().optional(),
});

export type FieldValidationRow = z.infer<typeof fieldValidationRowSchema>;

export const crossDocumentStatusSchema = z.enum(["consistent", "inconsistent", "insufficient_data"]);

export const crossDocumentFieldRowSchema = z.object({
  field: tradeFieldKeySchema,
  status: crossDocumentStatusSchema,
  expected: z.string().nullable().optional(),
  notes: z.string().optional(),
  foundByDocument: z.array(
    z.object({
      filename: z.string(),
      value: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      sourceSnippet: z.string().nullable().optional(),
    })
  ),
});

export type CrossDocumentFieldRow = z.infer<typeof crossDocumentFieldRowSchema>;

export const crossDocumentValidationSchema = z.object({
  rows: z.array(crossDocumentFieldRowSchema),
  hasInconsistency: z.boolean(),
});

export type CrossDocumentValidation = z.infer<typeof crossDocumentValidationSchema>;

/** Rule-based field checks for one attachment (same row shape as shipment-level `rows`). */
export const perDocumentValidationSchema = z.object({
  filename: z.string(),
  rows: z.array(fieldValidationRowSchema),
  hasUncertain: z.boolean(),
  hasMismatch: z.boolean(),
});

export type PerDocumentValidation = z.infer<typeof perDocumentValidationSchema>;

export const validationResultSchema = z.object({
  customerId: z.string(),
  /** Merged extraction vs rules (routing policy uses this summary). */
  rows: z.array(fieldValidationRowSchema),
  /** Any uncertain row blocks silent auto-approval */
  hasUncertain: z.boolean(),
  hasMismatch: z.boolean(),
  crossDocument: crossDocumentValidationSchema.optional(),
  /** Per-attachment rule checks for UI (optional for legacy persisted runs). */
  perDocument: z.array(perDocumentValidationSchema).optional(),
});

export type ValidationResult = z.infer<typeof validationResultSchema>;

export const VALIDATION_RESULT_JSON_SCHEMA = zodToJsonSchema(validationResultSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;
