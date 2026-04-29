import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "sample-docs");
mkdirSync(outDir, { recursive: true });

async function buildClean() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    "COMMERCIAL INVOICE",
    "",
    "Consignee: Acme Imports Ltd",
    "Invoice No: INV-2025-0042",
    "Incoterms: FOB Shanghai",
    "Port of Loading: Shanghai",
    "Port of Discharge: Los Angeles",
    "HS Code: 8471300100",
    "Description: Laptop computers — Model X200",
    "Gross Weight: 1250 KG",
  ];
  let y = 720;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: line.startsWith("COMMERCIAL") ? 16 : 11, font, color: rgb(0, 0, 0) });
    y -= line === "" ? 10 : 22;
  }
  const bytes = await doc.save();
  writeFileSync(join(outDir, "sample-clean.pdf"), bytes);
  console.log("Wrote sample-clean.pdf");
}

async function buildMessy() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("SCAN COPY", {
    x: 120,
    y: 400,
    size: 64,
    font,
    color: rgb(0.92, 0.92, 0.92),
    rotate: degrees(35),
  });
  const messy = [
    "Inv# INV-2024-zz (see stamp)",
    "Cnee: ACME IMP0RTS LTD",
    "Terms: exw shanghai??", 
    "POL: Ningbo / maybe Shanghai crossed out",
    "POD: Long Beach",
    "HS 85171200", 
    "Goods: assorted consumer electronics (illegible line)",
    "G.W. approx 900-1100 kg",
  ];
  let y = 680;
  for (const line of messy) {
    page.drawText(line, { x: 48 + (y % 7), y, size: 10, font, color: rgb(0.15, 0.15, 0.18) });
    y -= 26;
  }
  const bytes = await doc.save();
  writeFileSync(join(outDir, "sample-messy.pdf"), bytes);
  console.log("Wrote sample-messy.pdf");
}

await buildClean();
await buildMessy();
