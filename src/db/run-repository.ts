import type { ExtractionOutput } from "../contracts/extraction.js";
import type { ValidationResult } from "../contracts/validation.js";
import type { RouterDecision } from "../contracts/router.js";
import type { PipelineStage } from "../contracts/run-state.js";
import { Run } from "./sequelize.js";

export type RunInsert = {
  runId: string;
  shipmentId?: string | null;
  customerId: string;
  createdAt: string;
  updatedAt: string;
  stage: PipelineStage;
  sourceFilename: string;
  sourceMime: string;
  sourceFilenames?: string[] | null;
  sourceMimes?: string[] | null;
  inboxSender?: string | null;
  inboxSubject?: string | null;
  extraction?: ExtractionOutput | null;
  extractionRawJson?: string | null;
  validation?: ValidationResult | null;
  decision?: RouterDecision | null;
  draftReply?: string | null;
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
        shipment_id: row.shipmentId ?? row.runId,
        customer_id: row.customerId,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        stage: row.stage,
        source_filename: row.sourceFilename,
        source_mime: row.sourceMime,
        source_filenames_json: row.sourceFilenames ? JSON.stringify(row.sourceFilenames) : null,
        source_mimes_json: row.sourceMimes ? JSON.stringify(row.sourceMimes) : null,
        inbox_sender: row.inboxSender ?? null,
        inbox_subject: row.inboxSubject ?? null,
        extraction_json: extractionJson,
        extraction_raw_json: row.extractionRawJson ?? null,
        validation_json: validationJson,
        decision_json: decisionJson,
        decision_kind: decisionKind,
        draft_reply: row.draftReply ?? row.decision?.draftReply ?? null,
        flagged_human: flaggedHuman(row.decision),
        estimated_cost_usd: row.estimatedCostUsd ?? null,
        error_message: row.errorMessage ?? null,
      },
      {
        conflictFields: ["run_id"],
        fields: [
          "run_id",
          "shipment_id",
          "customer_id",
          "created_at",
          "updated_at",
          "stage",
          "source_filename",
          "source_mime",
          "source_filenames_json",
          "source_mimes_json",
          "inbox_sender",
          "inbox_subject",
          "extraction_json",
          "extraction_raw_json",
          "validation_json",
          "decision_json",
          "decision_kind",
          "draft_reply",
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
    shipmentId: row.shipment_id != null ? String(row.shipment_id) : null,
    customerId: String(row.customer_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    stage: row.stage as PipelineStage,
    sourceFilename: String(row.source_filename),
    sourceMime: String(row.source_mime),
    sourceFilenames: row.source_filenames_json
      ? (JSON.parse(String(row.source_filenames_json)) as string[])
      : null,
    sourceMimes: row.source_mimes_json ? (JSON.parse(String(row.source_mimes_json)) as string[]) : null,
    inboxSender: row.inbox_sender != null ? String(row.inbox_sender) : null,
    inboxSubject: row.inbox_subject != null ? String(row.inbox_subject) : null,
    extraction: row.extraction_json ? (JSON.parse(String(row.extraction_json)) as ExtractionOutput) : null,
    extractionRawJson: row.extraction_raw_json != null ? String(row.extraction_raw_json) : null,
    validation: row.validation_json ? (JSON.parse(String(row.validation_json)) as ValidationResult) : null,
    decision: row.decision_json ? (JSON.parse(String(row.decision_json)) as RouterDecision) : null,
    draftReply: row.draft_reply != null ? String(row.draft_reply) : null,
    estimatedCostUsd: row.estimated_cost_usd != null ? Number(row.estimated_cost_usd) : null,
    errorMessage: row.error_message != null ? String(row.error_message) : null,
  };
}
