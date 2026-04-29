# Nova pipeline

Gated pipeline for trade documents (BOL, invoice, packing list, etc.): **Extractor** (vision LLM) → **Validator** (customer rules) → **Router** (policy + explicit reasoning) → **PostgreSQL** persistence and **grounded NL→SQL** analytics. Includes a **React + Material UI** UI (bundled with **Vite**) for one-document runs.

## Prerequisites

- Node.js **20+**
- **PostgreSQL** 14+ (empty database; the API uses **Sequelize** `sync` on startup to create the `runs` table if missing, then creates indexes idempotently)
- [OpenAI API key](https://platform.openai.com/) with access to vision-capable models (default: `gpt-4o`)

## Quick start

```bash
cp .env.example .env
# Edit .env: set OPENAI_API_KEY and DATABASE_URL (e.g. postgresql://user:pass@localhost:5432/nova_daw)

#setup postgres
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nova_daw

npm install
npm run db:generate-samples   # creates sample-docs/*.pdf (optional if PDFs already present)
npm run dev
```

- **API:** http://localhost:3001  
- **UI (Vite dev):** http://localhost:5173 (proxies `/api` to the API)

Production-style single port:

```bash
npm run build
OPENAI_API_KEY=... DATABASE_URL=postgresql://... npm start
# UI + API: http://localhost:3001
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | **Required.** PostgreSQL connection URI (`postgresql://…`) |
| `PG_POOL_MAX` | Optional max clients in pool (default `10`) |
| `OPENAI_API_KEY` | Required for extraction and NL→SQL |
| `OPENAI_VISION_MODEL` | Default `gpt-4o` |
| `OPENAI_TEXT_MODEL` | Default `gpt-4o-mini` (NL layer) |
| `PORT` | API port (default `3001`) |
| `RULES_DIR` | Directory of `<customerId>.json` rule files (default `./rules`) |

## API

- `POST /api/runs` — `multipart/form-data` with field `file` (PDF or image) and optional `customerId` (defaults to `default-customer`).
- `GET /api/runs/:id` — Fetch persisted run (extraction, validation, decision).
- `POST /api/query/nl` — JSON `{ "question": "..." }`; returns `{ sql, rows, rowCount }` after **read-only** validation (single `SELECT` on `runs` only).

## Customer rules

JSON files in `rules/` named `<customerId>.json`. Unknown `customerId` falls back to `default-customer.json`. See `schemas/customer-rule-set.schema.json` or TypeScript `CustomerRuleSet` in `src/contracts/customer-rules.ts`.

## Contracts and JSON Schema

TypeScript types and Zod live under `src/contracts/`. Committed JSON Schema snapshots:

```bash
npm run export-schemas   # writes ./schemas/*.schema.json
```

## Sample documents

- `sample-docs/sample-clean.pdf` — aligns with `rules/default-customer.json` (intended path: auto-approve after successful extraction).
- `sample-docs/sample-messy.pdf` — noisy layout / ambiguous text (intended path: uncertain fields → **human review**, never silent approval).

Regenerate with:

```bash
npm run db:generate-samples
```
