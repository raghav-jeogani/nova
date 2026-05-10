import type { ExtractionOutput } from "../contracts/extraction.js";
import type { TradeFieldKey, CrossDocumentValidation } from "../contracts/validation.js";

export type DocumentExtraction = {
  filename: string;
  extraction: ExtractionOutput;
};

/** Fields compared across attachments for the same shipment (same semantic value expected on each doc). */
const CROSS_FIELDS: TradeFieldKey[] = [
  "consigneeName",
  "hsCode",
  "incoterms",
  "portOfLoading",
  "portOfDischarge",
];

function normalizeValue(field: TradeFieldKey, value: string): string {
  const base = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (field === "hsCode") return base.replace(/\D/g, "");
  return base;
}

export function validateCrossDocumentConsistency(documents: DocumentExtraction[]): CrossDocumentValidation {
  const rows: CrossDocumentValidation["rows"] = CROSS_FIELDS.map((field) => {
    const foundByDocument = documents.map((doc) => {
      const extracted = doc.extraction[field];
      return {
        filename: doc.filename,
        value: extracted.value,
        confidence: extracted.confidence,
        sourceSnippet: extracted.value,
      };
    });

    const present = foundByDocument.filter((x) => x.value && x.value.trim() !== "");
    if (present.length < 2) {
      return {
        field,
        status: "insufficient_data",
        notes: "At least two documents are required for consistency check.",
        foundByDocument,
      };
    }

    const normalized = present.map((x) => normalizeValue(field, x.value ?? ""));
    const first = normalized[0];
    const allSame = normalized.every((v) => v === first);
    if (allSame) {
      return {
        field,
        status: "consistent",
        expected: present[0]?.value ?? null,
        notes: "Field is consistent across shipment attachments.",
        foundByDocument,
      };
    }

    return {
      field,
      status: "inconsistent",
      expected: present[0]?.value ?? null,
      notes: "Cross-document mismatch detected.",
      foundByDocument,
    };
  });

  return {
    rows,
    hasInconsistency: rows.some((row) => row.status === "inconsistent"),
  };
}
