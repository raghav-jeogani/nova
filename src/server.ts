import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { sequelize, initDb } from "./db/sequelize.js";
import { RunRepository } from "./db/run-repository.js";
import { defaultRulesLoader, processUpload } from "./pipeline/orchestrator.js";
import { runGroundedNlQuery } from "./nl/guarded-query.js";

const PORT = Number(process.env.PORT ?? 3001);
const RULES_DIR = process.env.RULES_DIR ?? join(process.cwd(), "rules");
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

  const server: Server = app.listen(PORT, "0.0.0.0", () => {
    console.info(`API listening on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
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
