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

/** Three synthetic trade PDFs with different consignee / HS / incoterms for cross-document consistency checks. */
async function buildCrossDocSet() {
  const fontSize = 11;
  const sets: Array<{ file: string; title: string; lines: string[] }> = [
    {
      file: "cross-doc-a.pdf",
      title: "BILL OF LADING",
      lines: [
        "",
        "Consignee: Northwind Traders GmbH",
        "Invoice No: INV-2025-CROSS-A",
        "Incoterms: FOB Shanghai",
        "Port of Loading: Shanghai",
        "Port of Discharge: Los Angeles",
        "HS Code: 8471300100",
        "Description: Laptop computers — batch A",
        "Gross Weight: 1000 KG",
      ],
    },
    {
      file: "cross-doc-b.pdf",
      title: "COMMERCIAL INVOICE",
      lines: [
        "",
        "Consignee: Contoso Global BV",
        "Invoice No: INV-2025-CROSS-B",
        "Incoterms: CIF Rotterdam",
        "Port of Loading: Ningbo",
        "Port of Discharge: Rotterdam",
        "HS Code: 8504409550",
        "Description: Power supplies — batch B",
        "Gross Weight: 1100 KG",
      ],
    },
    {
      file: "cross-doc-c.pdf",
      title: "PACKING LIST",
      lines: [
        "",
        "Consignee: Fabrikam Industries SAS",
        "Invoice No: INV-2025-CROSS-C",
        "Incoterms: EXW Shenzhen",
        "Port of Loading: Shenzhen",
        "Port of Discharge: Long Beach",
        "HS Code: 8471605010",
        "Description: Mixed IT equipment — batch C",
        "Gross Weight: 1200 KG",
      ],
    },
  ];
  for (const { file, title, lines } of sets) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let y = 720;
    page.drawText(title, { x: 50, y, size: 16, font, color: rgb(0, 0, 0) });
    y -= 32;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: line === "" ? fontSize : fontSize, font, color: rgb(0, 0, 0) });
      y -= line === "" ? 10 : 22;
    }
    writeFileSync(join(outDir, file), await doc.save());
    console.log(`Wrote ${file}`);
  }
}

await buildClean();
await buildMessy();
await buildCrossDocSet();
