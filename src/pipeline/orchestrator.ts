import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import type { CustomerRuleSet } from "../contracts/customer-rules.js";
import { customerRuleSetSchema } from "../contracts/customer-rules.js";
import { extractFromDocument } from "./extractor.js";
import { validateExtraction } from "./validator.js";
import { routeFromValidation } from "./router.js";
import type { RunRepository } from "../db/run-repository.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type OrchestratorDeps = {
  openai: OpenAI;
  runs: RunRepository;
  loadRules: (customerId: string) => CustomerRuleSet;
};

function nowIso(): string {
  return new Date().toISOString();
}

export async function processUpload(
  deps: OrchestratorDeps,
  input: { buffer: Buffer; mime: string; filename: string; customerId: string }
): Promise<string> {
  const runId = uuidv4();
  const t0 = nowIso();
  const base = {
    runId,
    customerId: input.customerId,
    createdAt: t0,
    updatedAt: t0,
    sourceFilename: input.filename,
    sourceMime: input.mime,
  };

  await deps.runs.upsertRun({
    ...base,
    stage: "uploaded",
  });

  try {
    await deps.runs.upsertRun({ ...base, updatedAt: nowIso(), stage: "extracting" });
    const extracted = await extractFromDocument(deps.openai, {
      buffer: input.buffer,
      mime: input.mime,
      filename: input.filename,
    });

    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "extracted",
      extraction: extracted.extraction,
      extractionRawJson: extracted.rawModelJson,
      estimatedCostUsd: extracted.estimatedCostUsd,
    });

    const rules = deps.loadRules(input.customerId);
    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "validating",
      extraction: extracted.extraction,
      extractionRawJson: extracted.rawModelJson,
      estimatedCostUsd: extracted.estimatedCostUsd,
    });
    const validation = validateExtraction(extracted.extraction, rules);

    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "validated",
      extraction: extracted.extraction,
      extractionRawJson: extracted.rawModelJson,
      validation,
      estimatedCostUsd: extracted.estimatedCostUsd,
    });

    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "routing",
      extraction: extracted.extraction,
      extractionRawJson: extracted.rawModelJson,
      validation,
      estimatedCostUsd: extracted.estimatedCostUsd,
    });
    const decision = routeFromValidation(validation);

    await deps.runs.upsertRun({
      ...base,
      updatedAt: nowIso(),
      stage: "persisted",
      extraction: extracted.extraction,
      extractionRawJson: extracted.rawModelJson,
      validation,
      decision,
      estimatedCostUsd: extracted.estimatedCostUsd,
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
