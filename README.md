# Nova pipeline

Part 2 workflow-ready pipeline for trade documents (BOL, invoice, packing list): **Extractor** (vision LLM per attachment) → **Validator** (customer rules on merged extract + **per-document** rule tables + **cross-attachment** consistency) → **Router** (decision + editable draft reply) → **PostgreSQL** persistence and **grounded NL→SQL** analytics. Includes a **React + Material UI** CG workflow UI with a simulated SU inbox (JSON drop + watcher).

## Prerequisites

- Node.js **20+**
- **PostgreSQL** 14+ (empty database; the API uses **Sequelize** `sync` on startup to create the `runs` table if missing, then creates indexes idempotently)
- [OpenAI API key](https://platform.openai.com/) with access to vision-capable models (default: `gpt-4o`)

## Quick start

```bash
cp .env.example .env
# Edit .env — required: OPENAI_API_KEY, DATABASE_URL
# Optional: Gmail for “Send email” in the UI — see “Gmail SMTP setup” below

# setup postgres (example)
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nova_daw

npm install
npm run db:generate-samples   # creates sample-docs/*.pdf (required for cross-doc demo PDFs)
npm run dev
```

- **API:** http://localhost:3001  
- **UI (Vite dev):** http://localhost:5173 (proxies `/api` to the API)

On API startup, the console prints whether **Gmail SMTP** is configured (`Gmail SMTP: configured…` or `not configured…`). If you change `.env`, **restart** `npm run dev` so the API reloads environment variables.

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
| `OPENAI_API_KEY` | Required for extraction, shipment processing, and NL→SQL |
| `OPENAI_VISION_MODEL` | Default `gpt-4o` |
| `OPENAI_TEXT_MODEL` | Default `gpt-4o-mini` (NL layer) |
| `PORT` | API port (default `3001`) |
| `RULES_DIR` | Directory of `<customerId>.json` rule files (default `./rules`) |
| `INBOX_DIR` | Simulated SU inbox folder watched by the API (default `./sample-emails/inbox`) |
| `GMAIL_USER` | Gmail address for SMTP auth (optional). Equivalent: `SMTP_USER`. |
| `GMAIL_APP_PASSWORD` | **Google App Password** only — see [Gmail SMTP setup](#gmail-smtp-setup-draft-replies-from-ui). Equivalent: `SMTP_PASS`. |
| `GMAIL_FROM` | Optional `From` address; defaults to `GMAIL_USER` / `SMTP_USER`. |

## Gmail SMTP setup (draft replies from UI)

The CG UI **Send email** button calls `POST /api/email/send-draft`, which signs in to **Gmail** with SMTP (`smtp.gmail.com:465`). Google **does not** allow your normal Gmail password for this; you must use an **[App Password](https://support.google.com/accounts/answer/185833)** when 2-Step Verification is on (recommended / required for consumer Gmail).

1. **Google Account** → **Security** → enable **[2-Step Verification](https://myaccount.google.com/security)** if it is not already on.
2. Open **[App passwords](https://myaccount.google.com/apppasswords)** (Security → 2-Step Verification → App passwords). Create one for **Mail** (or “Other” → name e.g. `Nova`).
3. Copy the **16-character** password Google shows (spaces are optional in `.env`).
4. In the **project root** `.env` (next to `package.json`), set **one** of these pairs (same mailbox for both lines):

   ```env
   GMAIL_USER=you@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```

   or:

   ```env
   SMTP_USER=you@gmail.com
   SMTP_PASS=xxxx xxxx xxxx xxxx
   ```

   Optionally set `GMAIL_FROM` to the same address if you send from an alias allowed in Gmail.

5. **Save** `.env` and **restart** the API (`npm run dev` or your process manager). Environment variables are read at **process start** only; `tsx watch` does not reload `.env` when the file changes.
6. Confirm in the API terminal: `Gmail SMTP: configured (send-draft endpoint enabled)`.

**Troubleshooting**

- **`534-5.7.9 Application-specific password required`** — You used the normal account password or OAuth-only access. Use a **Google App Password** in `GMAIL_APP_PASSWORD` / `SMTP_PASS`, not your daily login password.
- **`503` … not configured** — `GMAIL_USER` + `GMAIL_APP_PASSWORD` (or `SMTP_USER` + `SMTP_PASS`) are missing or empty in the saved `.env`, or the server was not restarted after editing.
- **Google Workspace** — An admin may need to allow app passwords or SMTP for your org.

## API

- `GET /api/health` — `{ ok, db }` liveness.
- `POST /api/runs` — `multipart/form-data` with field `file` (PDF or image) and optional `customerId` (legacy single-document upload).
- `GET /api/runs` — List recent runs/shipments (`?limit=`, capped at 100). Each row includes extraction, validation (merged `rows`, optional `perDocument`, optional `crossDocument`), decision, timestamps, attachment metadata.
- `GET /api/runs/:id` — Fetch one persisted run by `run_id`.
- `POST /api/inbox/simulate` — JSON body `{ "template": "clean" | "messy" | "cross-inconsistent", "customerId"?: string, ... }`. Writes a shipment JSON into `INBOX_DIR`; the inbox watcher picks it up and runs `processShipment` (multi-attachment). `cross-inconsistent` requires `cross-doc-*.pdf` from `npm run db:generate-samples` (returns **400** with a hint if files are missing).
- `POST /api/email/send-draft` — JSON `{ "to": "recipient@…", "body": "…", "subject"?: "…" }`. Sends **plain text** via **Gmail SMTP**. Returns **503** if neither `GMAIL_USER`+`GMAIL_APP_PASSWORD` nor `SMTP_USER`+`SMTP_PASS` is set ([setup](#gmail-smtp-setup-draft-replies-from-ui)).
- `POST /api/query/nl` — JSON `{ "question": "..." }`; returns `{ sql, rows, rowCount }` after **read-only** validation (single `SELECT` on `runs` only).

## Pipeline behavior (summary)

1. **Multi-attachment shipments** — Inbox JSON lists several PDFs/images; each file is extracted in parallel, then merged (highest confidence per field) for rule validation and routing.
2. **Merged validation** — `validateExtraction(merged, rules)` drives **router** policy (mismatch / uncertain / cross-doc inconsistent → human review or draft amendment).
3. **Per-document validation** — Same rules run on each attachment’s extraction; stored on `validation.perDocument[]` for the UI (not a second routing pass).
4. **Cross-document consistency** — For each of **consigneeName**, **hsCode**, **incoterms**, **portOfLoading**, **portOfDischarge**, values are compared across attachments after extraction. Rows are **consistent**, **inconsistent**, or **insufficient_data**. Inconsistencies feed the router (e.g. draft amendment) and the UI.

## Customer rules

JSON files in `rules/` named `<customerId>.json`. Unknown `customerId` falls back to `default-customer.json`. See `schemas/customer-rule-set.schema.json` or TypeScript `CustomerRuleSet` in `src/contracts/customer-rules.ts`.

## Contracts and JSON Schema

TypeScript types and Zod live under `src/contracts/`. Persisted runs use `validationResultSchema`, including optional `perDocument` and `crossDocument`. Committed JSON Schema snapshots:

```bash
npm run export-schemas   # writes ./schemas/*.schema.json
```

## Sample documents

| File | Purpose |
|------|---------|
| `sample-docs/sample-clean.pdf` | Aligns with `rules/default-customer.json` for a clean extraction path. |
| `sample-docs/sample-messy.pdf` | Noisy layout / ambiguous text (uncertain fields → human review). |
| `sample-docs/cross-doc-a.pdf`, `cross-doc-b.pdf`, `cross-doc-c.pdf` | Three deliberate **different** consignee / HS / incoterm / port lines for **cross-inconsistent** simulate / examples. |

- `sample-emails/examples/*.json` — Example inbox payloads (paths relative to `sample-emails/inbox`). Includes `cross-inconsistent-shipment.json` for manual copy into the inbox.

Regenerate PDFs with:

```bash
npm run db:generate-samples
```

## CG workflow UI (`src/client/App.tsx`)

- **Incoming trigger** — Buttons: simulate **clean**, **messy**, or **3-doc cross mismatch** (`cross-inconsistent`), plus refresh and show/hide history.
- **Incoming list** — Per run: timestamp + stage chip, shipment id, `#customerId · docs : N`.
- **Shipment summary** (above verification) — `customerId` and bulleted attachment names.
- **Verification** — For new runs with `validation.perDocument`, one table per attachment: **“Verification result for document *n*: *filename*”** (rule status per field). Older runs without `perDocument` show a single merged table.
- **Discrepancy detail** — (1) Narrative blocks for each **cross-document inconsistent** field: distinct values across files, per-file values, reference/notes. (2) Optional detail when you click a row in a verification table. (3) Summary table of all cross-document check rows.
- **Draft reply** — Editable plain text. **To** + **Send email** calls the API (Gmail SMTP on the server; configure env vars).

## Part 2 demo flow

1. Start the app with `npm run dev` and ensure `OPENAI_API_KEY` and `DATABASE_URL` are set. Optionally complete [Gmail SMTP setup](#gmail-smtp-setup-draft-replies-from-ui) to use **Send email** in the UI.
2. Open the UI at `http://localhost:5173`.
3. Use **Simulate clean shipment email**, **Simulate messy shipment email**, and **Simulate 3-doc cross mismatch** (after `npm run db:generate-samples`).
4. Select a run in **Incoming** and walk the panels: shipment summary → per-document verification (when present) → discrepancy / cross-doc narrative → draft reply → **To** + **Send email** (if Gmail is configured).
5. Run a grounded query, for example:
   - `show me everything pending review for customer default-customer`
   - `how many shipments were flagged this week`
