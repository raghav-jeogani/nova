import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import type { CustomerRuleSet } from "../contracts/customer-rules.js";
import { customerRuleSetSchema } from "../contracts/customer-rules.js";
import type { ExtractionOutput } from "../contracts/extraction.js";
import { extractFromDocument } from "./extractor.js";
import { validateExtraction } from "./validator.js";
import { routeFromValidation } from "./router.js";
import { validateCrossDocumentConsistency } from "./cross-validator.js";
import type { RunRepository } from "../db/run-repository.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type OrchestratorDeps = {
  openai: OpenAI;
  runs: RunRepository;
  loadRules: (customerId: string) => CustomerRuleSet;
};

export type ShipmentAttachment = {
  filename: string;
  mime: string;
  buffer: Buffer;
};

export type ShipmentInput = {
  shipmentId?: string;
  customerId: string;
  inboxSender?: string | null;
  inboxSubject?: string | null;
  attachments: ShipmentAttachment[];
};

function nowIso(): string {
  return new Date().toISOString();
}

export async function processUpload(
  deps: OrchestratorDeps,
  input: { buffer: Buffer; mime: string; filename: string; customerId: string }
): Promise<string> {
  return processShipment(deps, {
    customerId: input.customerId,
    attachments: [{ buffer: input.buffer, mime: input.mime, filename: input.filename }],
  });
}

function mergeExtractions(extractions: ExtractionOutput[]): ExtractionOutput {
  const first = extractions[0];
  if (!first) {
    throw new Error("Cannot merge empty extraction list");
  }
  const keys = Object.keys(first) as Array<keyof ExtractionOutput>;
  const merged = {} as ExtractionOutput;
  for (const key of keys) {
    let best = extractions[0][key];
    for (const extraction of extractions) {
      if (extraction[key].confidence > best.confidence) {
        best = extraction[key];
      }
    }
    merged[key] = best;
  }
  return merged;
}

export async function processShipment(deps: OrchestratorDeps, input: ShipmentInput): Promise<string> {
  if (input.attachments.length === 0) {
    throw new Error("Shipment requires at least one attachment");
  }

  const runId = uuidv4();
  const shipmentId = input.shipmentId ?? runId;
  const t0 = nowIso();
  const filenames = input.attachments.map((file) => file.filename);
  const mimes = input.attachments.map((file) => file.mime);
  const base = {
    runId,
    shipmentId,
    customerId: input.customerId,
    createdAt: t0,
    updatedAt: t0,
    sourceFilename: filenames[0] ?? "shipment.bin",
    sourceMime: mimes[0] ?? "application/octet-stream",
    sourceFilenames: filenames,
    sourceMimes: mimes,
    inboxSender: input.inboxSender ?? null,
    inboxSubject: input.inboxSubject ?? null,
  };

  await deps.runs.upsertRun({
    ...base,
    stage: "uploaded",
  });

  try {
    await deps.runs.upsertRun({ ...base, updatedAt: nowIso(), stage: "extracting" });
    const extractedByDoc = await Promise.all(
      input.attachments.map(async (doc) => {
        const extracted = await extractFromDocument(deps.openai, {
          buffer: doc.buffer,
          mime: doc.mime,
          filename: doc.filename,
        });
        return {
          filename: doc.filename,
          mime: doc.mime,
          extraction: extracted.extraction,
          rawModelJson: extracted.rawModelJson,
          estimatedCostUsd: extracted.estimatedCostUsd,
        };
      })
    );
    const mergedExtraction = mergeExtractions(extractedByDoc.map((x) => x.extraction));
    const extractionRawJson = JSON.stringify(
      extractedByDoc.map((x) => ({ filename: x.filename, extraction: x.extraction })),
      null,
      2
    );
    const estimatedCostUsd = extractedByDoc.reduce((acc, item) => acc + item.estimatedCostUsd, 0);

    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "extracted",
      extraction: mergedExtraction,
      extractionRawJson,
      estimatedCostUsd,
    });

    const rules = deps.loadRules(input.customerId);
    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "validating",
      extraction: mergedExtraction,
      extractionRawJson,
      estimatedCostUsd,
    });
    const validation = validateExtraction(mergedExtraction, rules);
    const crossDocument = validateCrossDocumentConsistency(
      extractedByDoc.map((doc) => ({
        filename: doc.filename,
        extraction: doc.extraction,
      }))
    );
    const perDocument = extractedByDoc.map((doc) => {
      const v = validateExtraction(doc.extraction, rules);
      return {
        filename: doc.filename,
        rows: v.rows,
        hasUncertain: v.hasUncertain,
        hasMismatch: v.hasMismatch,
      };
    });
    const combinedValidation = {
      ...validation,
      crossDocument,
      perDocument,
    };

    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "validated",
      extraction: mergedExtraction,
      extractionRawJson,
      validation: combinedValidation,
      estimatedCostUsd,
    });

    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "routing",
      extraction: mergedExtraction,
      extractionRawJson,
      validation: combinedValidation,
      estimatedCostUsd,
    });
    const decision = routeFromValidation(combinedValidation);

    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "persisted",
      extraction: mergedExtraction,
      extractionRawJson,
      validation: combinedValidation,
      decision,
      draftReply: decision.draftReply ?? null,
      estimatedCostUsd,
    });

    return runId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "failed",
      errorMessage: message,
    });
    throw err;
  }
}

export function defaultRulesLoader(rulesDir: string): (customerId: string) => CustomerRuleSet {
  return (customerId: string) => {
    const path = join(rulesDir, `${customerId}.json`);
    try {
      const raw = readFileSync(path, "utf8");
      return customerRuleSetSchema.parse(JSON.parse(raw));
    } catch {
      const fallback = join(rulesDir, "default-customer.json");
      const raw = readFileSync(fallback, "utf8");
      return customerRuleSetSchema.parse(JSON.parse(raw));
    }
  };
}
