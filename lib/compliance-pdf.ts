import { parseComplianceDocuments, type ComplianceTextDocument } from "./compliance.ts";
import { normalizeText } from "./reconciliation.ts";
import type { ParsedComplianceBatch } from "./compliance-types";

type PositionedText = {
  text: string;
  x: number;
  y: number;
};

export async function parseComplianceFiles(files: File[]): Promise<ParsedComplianceBatch> {
  const pdfFiles = files.filter(
    (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
  );
  if (!pdfFiles.length) throw new Error("Selecione ao menos um arquivo PDF.");
  if (pdfFiles.length !== files.length) {
    throw new Error("Este módulo aceita somente arquivos PDF nesta versão.");
  }

  const documents: ComplianceTextDocument[] = [];
  for (const file of pdfFiles) documents.push(await extractPdfDocument(file));
  return parseComplianceDocuments(documents);
}

async function extractPdfDocument(file: File): Promise<ComplianceTextDocument> {
  ensurePdfJsCompatibility();
  const runningInBrowser = typeof window !== "undefined";
  const [buffer, sha256, pdfjs] = await Promise.all([
    file.arrayBuffer(),
    sha256File(file),
    runningInBrowser
      ? import("pdfjs-dist")
      : import("pdfjs-dist/legacy/build/pdf.mjs"),
  ]);

  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      runningInBrowser
        ? "pdfjs-dist/build/pdf.worker.min.mjs"
        : "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: ComplianceTextDocument["pages"] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned: PositionedText[] = content.items
      .filter(
        (item): item is typeof item & { str: string; transform: number[] } =>
          "str" in item && "transform" in item,
      )
      .map((item) => ({
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5],
      }))
      .filter((item) => item.text);
    const lines = groupRows(positioned).map((row) => row.map((item) => item.text).join(" "));
    pages.push({ pageNumber, lines, text: lines.join("\n") });
  }

  const allText = pages.map((page) => page.text).join("\n");
  const normalized = normalizeText(allText);
  const documentType = normalized.includes("controle mensal de sac")
    ? "sisagua_monthly"
    : normalized.includes("controle semestral de sac")
      ? "sisagua_semiannual"
      : normalized.includes("relatorio de analises")
        ? "laboratory_report"
        : "unknown";

  return {
    file: {
      name: file.name,
      size: file.size,
      sha256,
      pages: document.numPages,
      documentType,
    },
    pages,
  };
}

function groupRows(items: PositionedText[]): PositionedText[][] {
  const rows: Array<{ y: number; items: PositionedText[] }> = [];
  for (const item of [...items].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const current = rows.find((row) => Math.abs(row.y - item.y) <= 2.5);
    if (current) current.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.items.sort((left, right) => left.x - right.x));
}

function ensurePdfJsCompatibility() {
  const prototype = Uint8Array.prototype as Uint8Array & {
    toHex?: (this: Uint8Array) => string;
  };
  if (!prototype.toHex) {
    Object.defineProperty(prototype, "toHex", {
      configurable: true,
      value(this: Uint8Array) {
        return [...this]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      },
    });
  }

  const math = Math as Math & { sumPrecise?: (values: Iterable<number>) => number };
  if (!math.sumPrecise) {
    Object.defineProperty(math, "sumPrecise", {
      configurable: true,
      value(values: Iterable<number>) {
        let sum = 0;
        let correction = 0;
        for (const value of values) {
          const adjusted = value - correction;
          const next = sum + adjusted;
          correction = next - sum - adjusted;
          sum = next;
        }
        return sum;
      },
    });
  }
}

async function sha256File(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
