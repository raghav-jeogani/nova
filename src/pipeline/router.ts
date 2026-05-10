import type { ValidationResult, FieldValidationRow } from "../contracts/validation.js";
import type { RouterDecision } from "../contracts/router.js";

const CRITICAL_FIELDS = new Set<FieldValidationRow["field"]>([
  "consigneeName",
  "hsCode",
  "incoterms",
  "invoiceNumber",
]);

/** Uncertain here is informational only — does not block auto-approve when no mismatches / hard-uncertain. */
const SOFT_UNCERTAIN_FIELDS = new Set<FieldValidationRow["field"]>(["descriptionOfGoods", "grossWeight"]);

/**
 * Router agent: deterministic policy over validation summary.
 * Never auto-approve on mismatches or blocking (hard) uncertain fields.
 * Soft uncertain (description / weight with no ruleset check) may still auto-approve when rules pass.
 */
function displayText(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function formatUncertainLine(r: FieldValidationRow, idx: number, tag: string): string {
  const expected = displayText(r.expected, "See customer rules / confirm with CG");
  const found = displayText(r.found, "Missing / unreadable");
  const note = r.notes ? ` (${r.notes})` : "";
  return `${idx + 1}. ${r.field} ${tag}${note}\n   - Found: ${found}\n   - Expected: ${expected}`;
}

function formatMismatchLine(r: FieldValidationRow, idx: number): string {
  const expected = displayText(r.expected, "See customer rules");
  const found = displayText(r.found, "Missing");
  const note = r.notes ? ` (${r.notes})` : "";
  return `${idx + 1}. ${r.field} [mismatch]${note}\n   - Found: ${found}\n   - Expected: ${expected}`;
}

function softUncertainAppendix(rows: FieldValidationRow[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r, i) => formatUncertainLine(r, i, "[CG awareness — no automated rule]")).join("\n");
  return `\n\nAlso noted for CG (extracted value present; confirm if needed):\n${lines}`;
}

export function routeFromValidation(validation: ValidationResult): RouterDecision {
  const uncertainRows = validation.rows.filter((r) => r.status === "uncertain");
  const softUncertain = uncertainRows.filter((r) => SOFT_UNCERTAIN_FIELDS.has(r.field));
  const hardUncertain = uncertainRows.filter((r) => !SOFT_UNCERTAIN_FIELDS.has(r.field));
  const mismatchRows = validation.rows.filter((r) => r.status === "mismatch");
  const criticalMismatches = mismatchRows.filter((r) => CRITICAL_FIELDS.has(r.field));
  const nonCriticalMismatches = mismatchRows.filter((r) => !CRITICAL_FIELDS.has(r.field));
  const crossInconsistencies =
    validation.crossDocument?.rows.filter((row) => row.status === "inconsistent") ?? [];

  const amendmentItems = [
    ...criticalMismatches.map((r) => ({
      field: r.field,
      found: r.found ?? null,
      expected: r.expected ?? null,
      sourceSnippet: r.notes ?? null,
    })),
    ...crossInconsistencies.map((r) => ({
      field: `${r.field} (cross-document)`,
      found: r.foundByDocument
        .map((doc) => `${doc.filename}: ${doc.value ?? "missing"}`)
        .join(" | "),
      expected: r.expected ?? null,
      sourceSnippet: r.foundByDocument
        .map((doc) => `${doc.filename} -> ${doc.sourceSnippet ?? "n/a"}`)
        .join("\n"),
    })),
  ];

  const draftHeader =
    "Dear Supplier,\n\nWe reviewed your latest shipment documents and found the following discrepancies:\n";
  const draftFooter =
    "\nPlease update and resend the corrected set (BOL, Invoice, and Packing List).\n\nRegards,\nCG Validation Team";
  const draftBody = amendmentItems
    .map((item, idx) => {
      const expected = displayText(item.expected, "Not specified");
      const found = displayText(item.found, "Missing");
      return `${idx + 1}. ${item.field}\n   - Found: ${found}\n   - Expected: ${expected}`;
    })
    .join("\n");

  if (hardUncertain.length > 0) {
    const fields = hardUncertain.map((r) => r.field).join(", ");
    const uncertainLines = hardUncertain.map((r, idx) => formatUncertainLine(r, idx, "[needs human review]")).join("\n");

    const mismatchLines =
      mismatchRows.length > 0
        ? "\n\nAdditionally, these fields failed rule checks:\n" +
          mismatchRows.map((r, idx) => formatMismatchLine(r, idx)).join("\n")
        : "";

    const softSuffix = softUncertainAppendix(softUncertain);

    return {
      kind: "human_review",
      reasoning: `Policy: any blocking uncertain field requires human review (never silent approval). Fields: ${fields}. Review extraction confidence and source document quality.`,
      draftReply:
        "Dear Supplier,\n\nWe need manual review for the following fields before final verification:\n" +
        `${uncertainLines}${mismatchLines}${softSuffix}\n\n` +
        "Please confirm/correct these values and resend the updated documents.\n\nRegards,\nCG Validation Team",
    };
  }

  if (criticalMismatches.length > 0 || crossInconsistencies.length > 0) {
    const softSuffix = softUncertainAppendix(softUncertain);
    return {
      kind: "draft_amendment",
      reasoning: `Critical fields failed validation (${criticalMismatches
        .map((r) => r.field)
        .join(", ")}). Cross-document inconsistencies: ${crossInconsistencies
        .map((r) => r.field)
        .join(", ")}. Draft amendment is prepared for CG review before send.`,
      amendmentSummary: amendmentItems,
      draftReply: `${draftHeader}${draftBody}${softSuffix}${draftFooter}`,
    };
  }

  if (nonCriticalMismatches.length > 0) {
    const fields = nonCriticalMismatches.map((r) => r.field).join(", ");
    const mismatchDraft = nonCriticalMismatches.map((r, idx) => formatMismatchLine(r, idx)).join("\n");
    const softSuffix = softUncertainAppendix(softUncertain);
    return {
      kind: "human_review",
      reasoning: `Non-critical mismatches detected on ${fields}. Route to operations to confirm whether ports/weights are acceptable under customer tolerance.`,
      amendmentSummary: nonCriticalMismatches.map((r) => ({
        field: r.field,
        found: r.found ?? null,
        expected: r.expected ?? null,
      })),
      draftReply:
        "Dear Supplier,\n\nWe found non-critical mismatches in the submitted documents:\n" +
        `${mismatchDraft}${softSuffix}\n\n` +
        "Please review and confirm whether the current values are acceptable for this shipment.\n\nRegards,\nCG Validation Team",
    };
  }

  const softOnly = softUncertain.length > 0 && mismatchRows.length === 0 && hardUncertain.length === 0;
  if (softOnly) {
    const softLines = softUncertain.map((r, idx) => formatUncertainLine(r, idx, "[informational]")).join("\n");
    return {
      kind: "auto_approve",
      reasoning:
        "All rule-backed fields matched customer requirements. Description / weight are flagged for optional CG confirmation only (no deterministic rule in ruleset). Safe to persist as verified output.",
      draftReply:
        "Dear Supplier,\n\nYour submitted shipment documents are verified and approved against automated rules.\n\n" +
        "Optional CG notes (informational):\n" +
        `${softLines}\n\n` +
        "Regards,\nCG Validation Team",
    };
  }

  return {
    kind: "auto_approve",
    reasoning:
      "All fields matched customer rules with no blocking uncertain statuses and no mismatches. Extraction confidence met minimum thresholds per validator configuration. Safe to persist as verified output.",
    draftReply:
      "Dear Supplier,\n\nYour submitted shipment documents are verified and approved. No amendments are required.\n\nRegards,\nCG Validation Team",
  };
}
