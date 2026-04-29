import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { extractionOutputSchema } from "./extraction.js";
import { validationResultSchema } from "./validation.js";
import { routerDecisionSchema } from "./router.js";

export const pipelineStageSchema = z.enum([
  "uploaded",
  "extracting",
  "extracted",
  "validating",
  "validated",
  "routing",
  "routed",
  "persisted",
  "failed",
]);

export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const persistedRunSchema = z.object({
  runId: z.string().uuid(),
  customerId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  stage: pipelineStageSchema,
  sourceFilename: z.string(),
  sourceMime: z.string(),
  /** Raw / debug payload from vision step (optional, truncated in API) */
  extractionRawJson: z.string().nullable().optional(),
  extraction: extractionOutputSchema.nullable(),
  validation: validationResultSchema.nullable(),
  decision: routerDecisionSchema.nullable(),
  errorMessage: z.string().nullable().optional(),
  /** Cumulative estimated USD cost for model calls on this run */
  estimatedCostUsd: z.number().optional(),
});

export type PersistedRun = z.infer<typeof persistedRunSchema>;

export const PERSISTED_RUN_JSON_SCHEMA = zodToJsonSchema(persistedRunSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;
