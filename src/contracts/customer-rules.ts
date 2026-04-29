import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Deterministic customer rule set used by the Validator agent. */
export const customerRuleSetSchema = z.object({
  customerId: z.string(),
  expectedConsignee: z.string().optional(),
  /** HS codes must start with one of these prefixes (digits), or uncertain */
  allowedHsPrefixes: z.array(z.string()).default([]),
  requiredIncoterms: z.array(z.string()).default([]),
  allowedPortsOfLoading: z.array(z.string()).default([]),
  allowedPortsOfDischarge: z.array(z.string()).default([]),
  /** Normalized substring or full invoice pattern (simple contains check) */
  expectedInvoiceContains: z.string().optional(),
  /** Minimum extraction confidence to avoid automatic "match" on empty/low signal */
  minConfidenceForMatch: z.number().min(0).max(1).default(0.55),
});

export type CustomerRuleSet = z.infer<typeof customerRuleSetSchema>;

export const CUSTOMER_RULE_SET_JSON_SCHEMA = zodToJsonSchema(customerRuleSetSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;
