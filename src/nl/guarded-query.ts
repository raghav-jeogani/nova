import type { Sequelize } from "sequelize";
import { QueryTypes } from "sequelize";
import OpenAI from "openai";

const SCHEMA_HINT = `
Table: runs
Columns:
- run_id TEXT (UUID)
- customer_id TEXT
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ
- stage TEXT
- source_filename TEXT
- source_mime TEXT
- decision_kind TEXT — one of: auto_approve, human_review, draft_amendment
- flagged_human INTEGER — 1 if human review or amendment needed
- estimated_cost_usd DOUBLE PRECISION
- error_message TEXT
JSON payloads are in extraction_json, validation_json, decision_json (TEXT; parse as JSON in queries if needed).
`;

const FORBIDDEN =
  /\b(attach|pragma|vacuum|delete|insert|update|drop|alter|create|replace|detach|reindex|analyze|transaction|savepoint|rollback|commit|copy|listen|notify|truncate|grant|revoke|call|execute)\b/i;

/**
 * Validates and runs a single read-only SELECT against PostgreSQL.
 */
export function assertSafeSelect(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/g, "");
  if (!/^\s*select\s/i.test(trimmed)) {
    throw new Error("Only SELECT queries are allowed");
  }
  if (/;/g.test(trimmed)) {
    throw new Error("Multiple statements are not allowed");
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new Error("Query contains forbidden keyword");
  }
  if (!/\bfrom\s+runs\b/i.test(trimmed)) {
    throw new Error("Query must read from runs table only");
  }
  if (/\bjoin\b/i.test(trimmed)) {
    throw new Error("JOIN queries are not allowed");
  }
  return trimmed;
}

export async function nlToSql(openai: OpenAI, question: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_TEXT_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    max_tokens: 220,
    messages: [
      {
        role: "system",
        content: `You translate natural language to a single PostgreSQL SELECT for analytics. ${SCHEMA_HINT}
Rules:
- Output ONLY the SQL text, no markdown fences, no explanation.
- Must be a single SELECT referencing table runs (schema public is default; do not prefix other schemas).
- For time windows use PostgreSQL, e.g. created_at >= NOW() - INTERVAL '7 days', or date_trunc('week', created_at).
- Prefer COUNT(*), SUM(estimated_cost_usd), GROUP BY decision_kind.
- If the question cannot be answered safely from this schema, output exactly: UNSUPPORTED`,
      },
      { role: "user", content: question },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!text || text === "UNSUPPORTED") {
    throw new Error("Model could not produce a supported SQL query for this question");
  }
  const cleaned = text.replace(/^```sql\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  return cleaned;
}

export type GroundedQueryResult = {
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
};

export async function runGroundedNlQuery(
  sequelize: Sequelize,
  openai: OpenAI,
  question: string
): Promise<GroundedQueryResult> {
  const rawSql = await nlToSql(openai, question);
  const sql = assertSafeSelect(rawSql);
  const rows = (await sequelize.query(sql, {
    type: QueryTypes.SELECT,
  })) as Record<string, unknown>[];
  return { sql, rows, rowCount: rows.length };
}
