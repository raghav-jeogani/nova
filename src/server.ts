import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { v4 as uuidv4 } from "uuid";
import { sequelize, initDb } from "./db/sequelize.js";
import { RunRepository } from "./db/run-repository.js";
import { defaultRulesLoader, processShipment, processUpload } from "./pipeline/orchestrator.js";
import { runGroundedNlQuery } from "./nl/guarded-query.js";
import { startInboxWatcher } from "./ingestion/inbox-watcher.js";
import { isGmailSmtpConfigured, sendPlainTextViaGmail } from "./email/send-gmail.js";

const PORT = Number(process.env.PORT ?? 3001);
const RULES_DIR = process.env.RULES_DIR ?? join(process.cwd(), "rules");
const INBOX_DIR = process.env.INBOX_DIR ?? join(process.cwd(), "sample-emails", "inbox");
const clientDist = join(process.cwd(), "dist", "client");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

async function main(): Promise<void> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.warn("Warning: OPENAI_API_KEY is not set. Pipeline calls will fail until configured.");
  }

  await initDb();

  const openai = new OpenAI({ apiKey: openaiKey ?? "missing-key" });
  const runs = new RunRepository();
  const loadRules = defaultRulesLoader(RULES_DIR);

  const app = express();

  app.use(cors({ origin: true }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, db: "postgres" });
  });

  app.post(
    "/api/runs",
    (req, res, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          res.status(400).json({ error: message });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      if (!openaiKey) {
        res.status(503).json({ error: "OPENAI_API_KEY not configured" });
        return;
      }
      const file = req.file;
      if (!file?.buffer) {
        res.status(400).json({ error: "file field required (multipart field name: file)" });
        return;
      }
      const customerId =
        typeof req.body.customerId === "string" && req.body.customerId.trim()
          ? req.body.customerId.trim()
          : "default-customer";
      const filename = file.originalname || "upload.bin";
      const mimetype = file.mimetype || "application/octet-stream";

      try {
        const runId = await processUpload(
          { openai, runs, loadRules },
          { buffer: file.buffer, mime: mimetype, filename, customerId }
        );
        const row = await runs.getById(runId);
        res.json({ runId, run: row });
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : "Pipeline failed";
        res.status(500).json({ error: message });
      }
    }
  );

  app.get("/api/runs/:id", async (req, res) => {
    const row = await runs.getById(req.params.id);
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ run: row });
  });

  app.get("/api/runs", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
    const rows = await runs.listRecent(limit);
    res.json({ runs: rows });
  });

  app.post("/api/inbox/simulate", express.json(), async (req, res) => {
    const raw = req.body?.template;
    const template =
      raw === "messy"
        ? "messy"
        : raw === "cross-inconsistent" || raw === "crossInconsistent"
          ? "cross-inconsistent"
          : "clean";
    const customerId =
      typeof req.body?.customerId === "string" && req.body.customerId.trim()
        ? req.body.customerId.trim()
        : "default-customer";
    const shipmentId = uuidv4();
    const filename = `shipment-${Date.now()}-${shipmentId}.json`;
    const sampleDocs = join(process.cwd(), "sample-docs");
    if (template === "cross-inconsistent") {
      for (const name of ["cross-doc-a.pdf", "cross-doc-b.pdf", "cross-doc-c.pdf"]) {
        if (!existsSync(join(sampleDocs, name))) {
          res.status(400).json({
            error: `Missing sample PDF ${name}. Run: npm run db:generate-samples`,
          });
          return;
        }
      }
    }

    const payload =
      template === "cross-inconsistent"
        ? {
            shipmentId,
            customerId,
            sender: req.body?.sender ?? "su.ops@example.com",
            subject: req.body?.subject ?? "Shipment docs (3-way cross-document mismatch)",
            attachments: [
              { path: join(sampleDocs, "cross-doc-a.pdf"), filename: "BOL.pdf" },
              { path: join(sampleDocs, "cross-doc-b.pdf"), filename: "Commercial-Invoice.pdf" },
              { path: join(sampleDocs, "cross-doc-c.pdf"), filename: "Packing-List.pdf" },
            ],
          }
        : (() => {
            const attachmentName = template === "messy" ? "sample-messy.pdf" : "sample-clean.pdf";
            return {
              shipmentId,
              customerId,
              sender: req.body?.sender ?? "su.ops@example.com",
              subject: req.body?.subject ?? `Shipment docs (${template})`,
              attachments: [
                {
                  path: join(sampleDocs, attachmentName),
                },
                {
                  path: join(sampleDocs, attachmentName),
                  filename: `invoice-${attachmentName}`,
                },
                {
                  path: join(sampleDocs, attachmentName),
                  filename: `packing-list-${attachmentName}`,
                },
              ],
            };
          })();
    mkdirSync(INBOX_DIR, { recursive: true });
    writeFileSync(join(INBOX_DIR, filename), JSON.stringify(payload, null, 2), "utf8");
    res.json({ ok: true, shipmentId, filename });
  });

  app.post("/api/email/send-draft", express.json(), async (req, res) => {
    if (!isGmailSmtpConfigured()) {
      res.status(503).json({
        error:
          "Gmail SMTP not configured. In the project root .env set GMAIL_USER and GMAIL_APP_PASSWORD (Google App Password), or SMTP_USER and SMTP_PASS — then save the file and restart the API (env is not hot-reloaded).",
      });
      return;
    }
    const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
    const text = typeof req.body?.body === "string" ? req.body.body : "";
    const subject =
      typeof req.body?.subject === "string" && req.body.subject.trim()
        ? String(req.body.subject).trim()
        : "Nova CG — shipment draft reply";
    if (!to) {
      res.status(400).json({ error: "Field 'to' (recipient email) is required" });
      return;
    }
    if (!text.trim()) {
      res.status(400).json({ error: "Field 'body' (draft reply text) is required and cannot be empty" });
      return;
    }
    try {
      await sendPlainTextViaGmail({ to, subject, text });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to send email";
      const status = message.includes("Invalid recipient") ? 400 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/query/nl", express.json(), async (req, res) => {
    if (!openaiKey) {
      res.status(503).json({ error: "OPENAI_API_KEY not configured" });
      return;
    }
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) {
      res.status(400).json({ error: "question required" });
      return;
    }
    try {
      const result = await runGroundedNlQuery(sequelize, openai, question);
      res.json(result);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Query failed";
      res.status(400).json({ error: message });
    }
  });

  app.use(express.static(clientDist));

  app.use((req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (existsSync(join(clientDist, "index.html"))) {
      res.sendFile("index.html", { root: clientDist });
      return;
    }
    res.status(404).json({
      message: "Client not built. Run npm run build or use npm run dev with Vite.",
    });
  });

  const stopInboxWatcher = startInboxWatcher({
    inboxDir: INBOX_DIR,
    onShipment: async (shipment) => {
      if (!openaiKey) return;
      await processShipment(
        { openai, runs, loadRules },
        {
          shipmentId: shipment.shipmentId,
          customerId: shipment.customerId,
          inboxSender: shipment.inboxSender,
          inboxSubject: shipment.inboxSubject,
          attachments: shipment.attachments,
        }
      );
    },
    onError: (err) => {
      console.error("Inbox watcher error:", err);
    },
  });

  const server: Server = app.listen(PORT, "0.0.0.0", () => {
    console.info(`API listening on http://localhost:${PORT}`);
    console.info(
      isGmailSmtpConfigured()
        ? "Gmail SMTP: configured (send-draft endpoint enabled)"
        : "Gmail SMTP: not configured — set GMAIL_USER + GMAIL_APP_PASSWORD (or SMTP_USER + SMTP_PASS) in .env and restart the API"
    );
  });

  const shutdown = async () => {
    stopInboxWatcher();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await sequelize.close().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
