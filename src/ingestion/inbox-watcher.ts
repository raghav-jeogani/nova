import { mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join, extname, isAbsolute } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { ShipmentAttachment } from "../pipeline/orchestrator.js";

export type InboxMessage = {
  shipmentId?: string;
  customerId: string;
  sender?: string;
  subject?: string;
  attachments: Array<{
    path: string;
    filename?: string;
    mime?: string;
  }>;
};

export type InboxShipment = {
  shipmentId: string;
  customerId: string;
  inboxSender: string | null;
  inboxSubject: string | null;
  attachments: ShipmentAttachment[];
};

export type InboxWatcherDeps = {
  inboxDir: string;
  onShipment: (shipment: InboxShipment) => Promise<void>;
  onError?: (err: unknown) => void;
};

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function detectMime(filename: string, provided?: string): string {
  if (provided && provided.trim()) return provided.trim();
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function toAbsolute(baseDir: string, filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  return join(baseDir, filePath);
}

function parseInboxMessage(inboxDir: string, filePath: string): InboxShipment {
  const raw = readFileSync(filePath, "utf8");
  const message = JSON.parse(raw) as InboxMessage;
  const shipmentId = message.shipmentId ?? uuidv4();
  const attachments: ShipmentAttachment[] = message.attachments.map((attachment) => {
    const absPath = toAbsolute(inboxDir, attachment.path);
    const filename = attachment.filename ?? attachment.path.split("/").at(-1) ?? "attachment.bin";
    return {
      filename,
      mime: detectMime(filename, attachment.mime),
      buffer: readFileSync(absPath),
    };
  });
  return {
    shipmentId,
    customerId: message.customerId,
    inboxSender: message.sender ?? null,
    inboxSubject: message.subject ?? null,
    attachments,
  };
}

export function startInboxWatcher(deps: InboxWatcherDeps): () => void {
  mkdirSync(deps.inboxDir, { recursive: true });
  const processedDir = join(deps.inboxDir, "processed");
  mkdirSync(processedDir, { recursive: true });

  const tick = async () => {
    const files = readdirSync(deps.inboxDir).filter((name) => name.endsWith(".json"));
    for (const filename of files) {
      const fullPath = join(deps.inboxDir, filename);
      const processingPath = join(deps.inboxDir, `${filename}.processing`);
      try {
        // Atomic claim to avoid duplicate processing across polling ticks.
        renameSync(fullPath, processingPath);
      } catch {
        continue;
      }
      try {
        const shipment = parseInboxMessage(deps.inboxDir, processingPath);
        await deps.onShipment(shipment);
        renameSync(processingPath, join(processedDir, `${Date.now()}-${filename}`));
      } catch (err) {
        deps.onError?.(err);
      }
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, 2000);

  void tick();
  return () => {
    clearInterval(timer);
  };
}
