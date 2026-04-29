import type { ExtractionOutput } from "../contracts/extraction.js";
import type { ValidationResult } from "../contracts/validation.js";
import type { RouterDecision } from "../contracts/router.js";
import type { PipelineStage } from "../contracts/run-state.js";
import { Run } from "./sequelize.js";

export type RunInsert = {
  runId: string;
  customerId: string;
  createdAt: string;
  updatedAt: string;
  stage: PipelineStage;
  sourceFilename: string;
  sourceMime: string;
  extraction?: ExtractionOutput | null;
  extractionRawJson?: string | null;
  validation?: ValidationResult | null;
  decision?: RouterDecision | null;
  estimatedCostUsd?: number | null;
  errorMessage?: string | null;
};

function flaggedHuman(decision: RouterDecision | null | undefined): number {
  if (!decision) return 0;
  return decision.kind === "human_review" || decision.kind === "draft_amendment" ? 1 : 0;
}

export class RunRepository {
  async upsertRun(row: RunInsert): Promise<void> {
    const extractionJson = row.extraction ? JSON.stringify(row.extraction) : null;
    const validationJson = row.validation ? JSON.stringify(row.validation) : null;
    const decisionJson = row.decision ? JSON.stringify(row.decision) : null;
    const decisionKind = row.decision?.kind ?? null;
    await Run.upsert(
      {
        run_id: row.runId,
        customer_id: row.customerId,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        stage: row.stage,
        source_filename: row.sourceFilename,
        source_mime: row.sourceMime,
        extraction_json: extractionJson,
        extraction_raw_json: row.extractionRawJson ?? null,
        validation_json: validationJson,
        decision_json: decisionJson,
        decision_kind: decisionKind,
        flagged_human: flaggedHuman(row.decision),
        estimated_cost_usd: row.estimatedCostUsd ?? null,
        error_message: row.errorMessage ?? null,
      },
      {
        conflictFields: ["run_id"],
        fields: [
          "run_id",
          "customer_id",
          "created_at",
          "updated_at",
          "stage",
          "source_filename",
          "source_mime",
          "extraction_json",
          "extraction_raw_json",
          "validation_json",
          "decision_json",
          "decision_kind",
          "flagged_human",
          "estimated_cost_usd",
          "error_message",
        ],
      }
    );
  }

  async getById(runId: string): Promise<RunInsert | null> {
    const row = await Run.findByPk(runId);
    if (!row) return null;
    return mapRow(row.get({ plain: true }) as Record<string, unknown>);
  }

  async listRecent(limit: number): Promise<RunInsert[]> {
    const rows = await Run.findAll({
      order: [["created_at", "DESC"]],
      limit,
    });
    return rows.map((r) => mapRow(r.get({ plain: true }) as Record<string, unknown>));
  }
}

function mapRow(row: Record<string, unknown>): RunInsert {
  const toIso = (v: unknown): string => {
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  return {
    runId: String(row.run_id),
    customerId: String(row.customer_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    stage: row.stage as PipelineStage,
    sourceFilename: String(row.source_filename),
    sourceMime: String(row.source_mime),
    extraction: row.extraction_json ? (JSON.parse(String(row.extraction_json)) as ExtractionOutput) : null,
    extractionRawJson: row.extraction_raw_json != null ? String(row.extraction_raw_json) : null,
    validation: row.validation_json ? (JSON.parse(String(row.validation_json)) as ValidationResult) : null,
    decision: row.decision_json ? (JSON.parse(String(row.decision_json)) as RouterDecision) : null,
    estimatedCostUsd: row.estimated_cost_usd != null ? Number(row.estimated_cost_usd) : null,
    errorMessage: row.error_message != null ? String(row.error_message) : null,
  };
}
