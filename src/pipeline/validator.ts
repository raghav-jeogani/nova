import type { ExtractionOutput } from "../contracts/extraction.js";
import type { CustomerRuleSet } from "../contracts/customer-rules.js";
import type { FieldValidationRow, TradeFieldKey, ValidationResult } from "../contracts/validation.js";

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function matchesPortList(found: string | null, allowed: string[]): boolean {
  if (!found || allowed.length === 0) return allowed.length === 0;
  const f = norm(found);
  return allowed.some((a) => f === norm(a) || f.includes(norm(a)) || norm(a).includes(f));
}

function validateField(
  field: TradeFieldKey,
  extraction: ExtractionOutput,
  rules: CustomerRuleSet
): FieldValidationRow {
  const minConf = rules.minConfidenceForMatch ?? 0.55;
  const row = (status: FieldValidationRow["status"], extra: Partial<FieldValidationRow>): FieldValidationRow => ({
    field,
    status,
    ...extra,
  });

  const get = (k: TradeFieldKey) => extraction[k];

  switch (field) {
    case "consigneeName": {
      const { value, confidence } = get("consigneeName");
      if (value == null || norm(value) === "") {
        return row("uncertain", { found: null, expected: rules.expectedConsignee ?? "", notes: "Missing consignee" });
      }
      if (confidence < minConf) {
        return row("uncertain", {
          found: value,
          expected: rules.expectedConsignee,
          notes: "Low extraction confidence",
        });
      }
      if (!rules.expectedConsignee) {
        return row("match", { found: value, notes: "No expected consignee rule" });
      }
      if (norm(value).includes(norm(rules.expectedConsignee)) || norm(rules.expectedConsignee).includes(norm(value))) {
        return row("match", { found: value, expected: rules.expectedConsignee });
      }
      return row("mismatch", { found: value, expected: rules.expectedConsignee });
    }
    case "hsCode": {
      const { value, confidence } = get("hsCode");
      if (value == null || norm(value) === "") {
        return row("uncertain", { found: null, notes: "Missing HS code" });
      }
      if (confidence < minConf) {
        return row("uncertain", { found: value, notes: "Low extraction confidence" });
      }
      const prefixes = rules.allowedHsPrefixes ?? [];
      if (prefixes.length === 0) {
        return row("match", { found: value, notes: "No HS prefix rules" });
      }
      const d = digitsOnly(value);
      const ok = prefixes.some((p) => d.startsWith(digitsOnly(p)));
      if (ok) return row("match", { found: value, expected: prefixes.join(", ") });
      return row("mismatch", { found: value, expected: `prefix in [${prefixes.join(", ")}]` });
    }
    case "incoterms": {
      const { value, confidence } = get("incoterms");
      if (value == null || norm(value) === "") {
        return row("uncertain", { found: null, notes: "Missing Incoterms" });
      }
      if (confidence < minConf) {
        return row("uncertain", { found: value, notes: "Low extraction confidence" });
      }
      const required = (rules.requiredIncoterms ?? []).map((x) => x.toUpperCase());
      if (required.length === 0) {
        return row("match", { found: value, notes: "No Incoterms rule" });
      }
      const upper = value.toUpperCase();
      const ok = required.some((r) => upper.includes(r));
      if (ok) return row("match", { found: value, expected: required.join(" or ") });
      return row("mismatch", { found: value, expected: required.join(" or ") });
    }
    case "portOfLoading": {
      const { value, confidence } = get("portOfLoading");
      if (value == null || norm(value) === "") {
        return row("uncertain", { found: null, notes: "Missing port of loading" });
      }
      if (confidence < minConf) {
        return row("uncertain", { found: value, notes: "Low extraction confidence" });
      }
      const allowed = rules.allowedPortsOfLoading ?? [];
      if (allowed.length === 0) return row("match", { found: value, notes: "No port whitelist" });
      if (matchesPortList(value, allowed)) return row("match", { found: value, expected: allowed.join(", ") });
      return row("mismatch", { found: value, expected: allowed.join(", ") });
    }
    case "portOfDischarge": {
      const { value, confidence } = get("portOfDischarge");
      if (value == null || norm(value) === "") {
        return row("uncertain", { found: null, notes: "Missing port of discharge" });
      }
      if (confidence < minConf) {
        return row("uncertain", { found: value, notes: "Low extraction confidence" });
      }
      const allowed = rules.allowedPortsOfDischarge ?? [];
      if (allowed.length === 0) return row("match", { found: value, notes: "No port whitelist" });
      if (matchesPortList(value, allowed)) return row("match", { found: value, expected: allowed.join(", ") });
      return row("mismatch", { found: value, expected: allowed.join(", ") });
    }
    case "invoiceNumber": {
      const { value, confidence } = get("invoiceNumber");
      if (value == null || norm(value) === "") {
        return row("uncertain", { found: null, notes: "Missing invoice number" });
      }
      if (confidence < minConf) {
        return row("uncertain", { found: value, notes: "Low extraction confidence" });
      }
      if (!rules.expectedInvoiceContains) {
        return row("match", { found: value, notes: "No invoice pattern rule" });
      }
      if (norm(value).includes(norm(rules.expectedInvoiceContains))) {
        return row("match", { found: value, expected: rules.expectedInvoiceContains });
      }
      return row("mismatch", { found: value, expected: `contains ${rules.expectedInvoiceContains}` });
    }
    case "descriptionOfGoods":
    case "grossWeight": {
      const f = get(field);
      if (f.value == null || norm(f.value) === "") {
        return row("uncertain", { found: null, notes: "Field missing" });
      }
      if (f.confidence < minConf) {
        return row("uncertain", { found: f.value, notes: "Low extraction confidence" });
      }
      return row("uncertain", { found: f.value, notes: "No deterministic rule" });
    }
    default:
      return row("uncertain", { notes: "Unknown field" });
  }
}

const ALL_FIELDS: TradeFieldKey[] = [
  "consigneeName",
  "hsCode",
  "portOfLoading",
  "portOfDischarge",
  "incoterms",
  "descriptionOfGoods",
  "grossWeight",
  "invoiceNumber",
];

export function validateExtraction(extraction: ExtractionOutput, rules: CustomerRuleSet): ValidationResult {
  const rows = ALL_FIELDS.map((field) => validateField(field, extraction, rules));
  const hasUncertain = rows.some((r) => r.status === "uncertain");
  const hasMismatch = rows.some((r) => r.status === "mismatch");
  return {
    customerId: rules.customerId,
    rows,
    hasUncertain,
    hasMismatch,
  };
}
