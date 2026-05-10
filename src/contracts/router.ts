import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const routerDecisionKindSchema = z.enum([
  "auto_approve",
  "human_review",
  "draft_amendment",
]);

export type RouterDecisionKind = z.infer<typeof routerDecisionKindSchema>;

export const routerDecisionSchema = z.object({
  kind: routerDecisionKindSchema,
  /** Human-readable explanation for UI and audit */
  reasoning: z.string().min(1),
  /** Draft email body for CG to review/edit before send */
  draftReply: z.string().optional(),
  /** Optional structured discrepancies for amendment path */
  amendmentSummary: z
    .array(
      z.object({
        field: z.string(),
        filename: z.string().optional(),
        found: z.string().nullable(),
        expected: z.string().nullable(),
        sourceSnippet: z.string().nullable().optional(),
      })
    )
    .optional(),
});

export type RouterDecision = z.infer<typeof routerDecisionSchema>;

export const ROUTER_DECISION_JSON_SCHEMA = zodToJsonSchema(routerDecisionSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;
