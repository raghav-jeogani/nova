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

export const validationResultSchema = z.object({
  customerId: z.string(),
  rows: z.array(fieldValidationRowSchema),
  /** Any uncertain row blocks silent auto-approval */
  hasUncertain: z.boolean(),
  hasMismatch: z.boolean(),
});

export type ValidationResult = z.infer<typeof validationResultSchema>;

export const VALIDATION_RESULT_JSON_SCHEMA = zodToJsonSchema(validationResultSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;
