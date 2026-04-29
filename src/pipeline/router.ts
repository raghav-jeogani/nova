import type { ValidationResult, FieldValidationRow } from "../contracts/validation.js";
import type { RouterDecision } from "../contracts/router.js";

const CRITICAL_FIELDS = new Set<FieldValidationRow["field"]>([
  "consigneeName",
  "hsCode",
  "incoterms",
  "invoiceNumber",
]);

/**
 * Router agent: deterministic policy over validation summary.
 * Never auto-approve if any row is uncertain or critical mismatch.
 */
export function routeFromValidation(validation: ValidationResult): RouterDecision {
  const uncertainRows = validation.rows.filter((r) => r.status === "uncertain");
  const mismatchRows = validation.rows.filter((r) => r.status === "mismatch");
  const criticalMismatches = mismatchRows.filter((r) => CRITICAL_FIELDS.has(r.field));
  const nonCriticalMismatches = mismatchRows.filter((r) => !CRITICAL_FIELDS.has(r.field));

  if (uncertainRows.length > 0) {
    const fields = uncertainRows.map((r) => r.field).join(", ");
    return {
      kind: "human_review",
      reasoning: `Policy: any uncertain field requires human review (never silent approval). Uncertain fields: ${fields}. Review extraction confidence and source document quality.`,
    };
  }

  if (criticalMismatches.length > 0) {
    const summary = criticalMismatches.map((r) => ({
      field: r.field,
      found: r.found ?? null,
      expected: r.expected ?? null,
    }));
    return {
      kind: "draft_amendment",
      reasoning: `Critical fields failed validation (${criticalMismatches
        .map((r) => r.field)
        .join(
          ", "
        )}). Draft amendment listing discrepancies for counterparty correction before storage as verified.`,
      amendmentSummary: summary,
    };
  }

  if (nonCriticalMismatches.length > 0) {
    const fields = nonCriticalMismatches.map((r) => r.field).join(", ");
    return {
      kind: "human_review",
      reasoning: `Non-critical mismatches detected on ${fields}. Route to operations to confirm whether ports/weights are acceptable under customer tolerance.`,
      amendmentSummary: nonCriticalMismatches.map((r) => ({
        field: r.field,
        found: r.found ?? null,
        expected: r.expected ?? null,
      })),
    };
  }

  return {
    kind: "auto_approve",
    reasoning:
      "All fields matched customer rules with no uncertain statuses and no mismatches. Extraction confidence met minimum thresholds per validator configuration. Safe to persist as verified output.",
  };
}
