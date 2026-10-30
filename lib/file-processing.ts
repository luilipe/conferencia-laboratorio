import * as XLSX from "xlsx";
import { normalizeText, sampleKey } from "./reconciliation.ts";
import type {
  BillingItem,
  CollectionSample,
  PdfMetadata,
  SourceFileMetadata,
} from "./types.ts";

const SAMPLE_PATTERN = /\b\d+-\d+\/\d{4}\.\d+\b/;
const MONEY_PATTERN = /(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})/g;

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
};

type ColumnStarts = {
  account: number;
  sample: number;
  identification: number;
  sampleType: number;
  price: number;
};

export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

  const math = Math as Math & {
    sumPrecise?: (values: Iterable<number>) => number;
  };
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

export async function parseCollectionFiles(files: File[]): Promise<{
  samples: CollectionSample[];
  files: SourceFileMetadata[];
}> {
  const samples = new Map<string, CollectionSample>();
  const metadata: SourceFileMetadata[] = [];

  for (const file of files) {
    const [buffer, sha256] = await Promise.all([file.arrayBuffer(), sha256File(file)]);
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      cellNF: false,
      cellText: false,
    });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error(`${file.name}: nenhuma aba foi encontrada.`);

    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
      header: 1,
      raw: true,
      defval: "",
    });
    if (rows.length < 2) throw new Error(`${file.name}: a planilha não contém dados.`);

    const headerRowIndex = findHeaderRow(rows);
    if (headerRowIndex < 0) {
      throw new Error(
        `${file.name}: não foi possível localizar a linha de cabeçalho com “Nº Amostra”.`,
      );
    }

    const headers = rows[headerRowIndex].map(normalizeText);
    const columns = {
      code: findColumn(headers, "Código da Amostra"),
      sample: findColumn(
        headers,
        "N° Amostra",
        "Nº Amostra",
        "Numero da Amostra",
        "Número da Amostra",
      ),
      proposal: findColumn(
        headers,
        "N° Proposta Comercial",
        "Nº Proposta Comercial",
      ),
      identification: findColumn(headers, "Identificação"),
      sampleType: findColumn(headers, "Tipo de Amostra"),
      company: findColumn(headers, "Empresa Solicitante"),
      collectionDate: findColumn(headers, "Data de Coleta"),
      publicationDate: findColumn(headers, "Data de Publicação"),
      opinion: findColumn(headers, "Parecer"),
      sampleStatus: findColumn(headers, "Situação da Amostra"),
      analysis: findColumn(headers, "Identificação da Análise"),
    };

    const required = [
      ["número da amostra", columns.sample],
      ["identificação", columns.identification],
      ["tipo de amostra", columns.sampleType],
      ["empresa solicitante", columns.company],
      ["data de coleta", columns.collectionDate],
      ["identificação da análise", columns.analysis],
    ] as const;
    const missing = required.filter(([, index]) => index < 0).map(([label]) => label);
    if (missing.length) {
      throw new Error(`${file.name}: coluna(s) obrigatória(s) ausente(s): ${missing.join(", ")}.`);
    }

    for (const row of rows.slice(headerRowIndex + 1)) {
      const key = sampleKey(row[columns.sample]);
      if (!key) continue;

      const previous = samples.get(key);
      const analysis = cleanCell(row[columns.analysis]);
      if (previous) {
        previous.sourceRows += 1;
        if (!previous.sourceFiles.includes(file.name)) previous.sourceFiles.push(file.name);
        if (analysis && !previous.analyses.includes(analysis)) previous.analyses.push(analysis);
        continue;
      }

      samples.set(key, {
        sampleNumber: cleanCell(row[columns.sample]),
        code: optionalCell(row, columns.code),
        proposal: optionalCell(row, columns.proposal),
        identification: cleanCell(row[columns.identification]),
        sampleType: cleanCell(row[columns.sampleType]),
        company: cleanCell(row[columns.company]),
        collectionDate: formatDateCell(row[columns.collectionDate]),
        publicationDate: optionalDateCell(row, columns.publicationDate),
        opinion: optionalCell(row, columns.opinion),
        sampleStatus: optionalCell(row, columns.sampleStatus),
        analyses: analysis ? [analysis] : [],
        sourceFiles: [file.name],
        sourceRows: 1,
      });
    }

    metadata.push({
      name: file.name,
      size: file.size,
      type: "excel",
      sha256,
    });
  }

  if (!samples.size) {
    throw new Error("Nenhuma amostra válida foi localizada nas planilhas selecionadas.");
  }

  return { samples: [...samples.values()], files: metadata };
}

export async function parseBillingPdf(file: File): Promise<{
  items: BillingItem[];
  metadata: PdfMetadata;
  file: SourceFileMetadata;
}> {
  ensurePdfJsCompatibility();
  const [buffer, sha256, pdfjs] = await Promise.all([
    file.arrayBuffer(),
    sha256File(file),
    import("pdfjs-dist"),
  ]);

  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const billingItems: BillingItem[] = [];
  const allLines: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned: PositionedText[] = content.items
      .filter(
        (item): item is typeof item & { str: string; width: number; transform: number[] } =>
          "str" in item && "transform" in item,
      )
      .map((item) => ({
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5],
        width: item.width ?? 0,
      }))
      .filter((item) => item.text);

    const rows = groupRows(positioned);
    allLines.push(...rows.map((row) => row.map((item) => item.text).join(" ")));
    const columnStarts = findColumnStarts(positioned);
    const sampleRows = rows
      .map((row) => {
        const line = row.map((item) => item.text).join(" ");
        const sampleNumber = line.match(SAMPLE_PATTERN)?.[0] ?? null;
        const sampleText = sampleNumber
          ? row.find((item) => item.text.includes(sampleNumber))
          : null;
        return { row, line, sampleNumber, y: sampleText?.y ?? row[0]?.y ?? 0 };
      })
      .filter((entry): entry is typeof entry & { sampleNumber: string } =>
        Boolean(entry.sampleNumber),
      );

    for (let index = 0; index < sampleRows.length; index += 1) {
      const current = sampleRows[index];
      const previousY = sampleRows[index - 1]?.y;
      const nextY = sampleRows[index + 1]?.y;
      const typicalGap = previousY != null
        ? Math.abs(previousY - current.y)
        : nextY != null
          ? Math.abs(current.y - nextY)
          : 16;
      const upperBoundary = previousY != null
        ? (previousY + current.y) / 2
        : current.y + typicalGap / 2;
      const lowerBoundary = nextY != null
        ? (current.y + nextY) / 2
        : current.y - typicalGap / 2;
      const rowBand = positioned.filter(
        (item) => item.y < upperBoundary && item.y >= lowerBoundary,
      );
      const fields = columnStarts
        ? assignColumns(rowBand, columnStarts)
        : inferColumns(current.row, current.sampleNumber);
      const price = parseMoney(fields.price || lastMoney(current.line));
      if (!Number.isFinite(price)) continue;

      billingItems.push({
        account: fields.account,
        sampleNumber: current.sampleNumber,
        identification: fields.identification,
        sampleType: fields.sampleType,
        price,
        page: pageNumber,
      });
    }
  }

  if (!billingItems.length) {
    throw new Error(
      "Nenhum item de cobrança foi reconhecido no PDF. Confirme se ele contém texto selecionável e segue o modelo homologado.",
    );
  }

  const combinedText = allLines.join("\n");
  const extractedTotal = roundCurrency(
    billingItems.reduce((total, item) => total + item.price, 0),
  );
  const reportedTotal = extractMoneyAfterLabel(combinedText, [
    "Preço Total da Medição",
    "Preco Total da Medicao",
  ]);

  return {
    items: billingItems,
    metadata: {
      measurementNumber: extractLineValue(combinedText, "Medição de Contrato"),
      sentDate: extractDateAfterLabel(combinedText, "Data de Envio"),
      orderDate: extractDateAfterLabel(combinedText, "Data do Pedido"),
      contractor: extractLineValue(combinedText, "Contratante"),
      pages: document.numPages,
      reportedTotal,
      extractedTotal,
    },
    file: { name: file.name, size: file.size, type: "pdf", sha256 },
  };
}

function findHeaderRow(rows: unknown[][]): number {
  return rows.slice(0, 20).findIndex((row) =>
    row.some((cell) => {
      const value = normalizeText(cell);
      return value === "n amostra" || value === "numero da amostra";
    }),
  );
}

function findColumn(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const index = headers.indexOf(normalizeText(name));
    if (index >= 0) return index;
  }
  return -1;
}

function cleanCell(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function optionalCell(row: unknown[], index: number): string {
  return index >= 0 ? cleanCell(row[index]) : "";
}

function optionalDateCell(row: unknown[], index: number): string {
  return index >= 0 ? formatDateCell(row[index]) : "";
}

function formatDateCell(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(value);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.d).padStart(2, "0")}/${String(parsed.m).padStart(2, "0")}/${parsed.y}`;
    }
  }
  return cleanCell(value);
}

function groupRows(items: PositionedText[]): PositionedText[][] {
  const rows: Array<{ y: number; items: PositionedText[] }> = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const current = rows.find((row) => Math.abs(row.y - item.y) <= 2.5);
    if (current) current.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.items.sort((a, b) => a.x - b.x));
}

function findColumnStarts(items: PositionedText[]): ColumnStarts | null {
  for (const row of groupRows(items)) {
    const findX = (...needles: string[]) =>
      row.find((item) => {
        const value = normalizeText(item.text);
        return needles.some((needle) => value.includes(needle));
      })?.x;
    const account = findX("conta");
    const sample = findX("numero", "amostra");
    const identification = findX("identificacao");
    const sampleType = findX("tipo");
    const price = findX("preco");
    if ([account, sample, identification, sampleType, price].some((value) => value == null)) {
      continue;
    }
    if (!(account! < sample! && sample! < identification! && identification! < sampleType! && sampleType! < price!)) {
      continue;
    }
    return {
      account: account!,
      sample: sample!,
      identification: identification!,
      sampleType: sampleType!,
      price: price!,
    };
  }
  return null;
}

function assignColumns(row: PositionedText[], starts: ColumnStarts) {
  const columns = [
    ["account", starts.account],
    ["sample", starts.sample],
    ["identification", starts.identification],
    ["sampleType", starts.sampleType],
    ["price", starts.price],
  ] as const;
  const values: Record<(typeof columns)[number][0], string[]> = {
    account: [],
    sample: [],
    identification: [],
    sampleType: [],
    price: [],
  };
  const boundaries = columns.slice(0, -1).map((column, index) =>
    (column[1] + columns[index + 1][1]) / 2,
  );

  for (const item of row) {
    const columnIndex = boundaries.findIndex((boundary) => item.x < boundary);
    const best = columns[columnIndex < 0 ? columns.length - 1 : columnIndex];
    values[best[0]].push(item.text);
  }
  return {
    account: values.account.join(" ").trim(),
    identification: values.identification.join(" ").trim(),
    sampleType: values.sampleType.join(" ").trim(),
    price: values.price.join(" ").trim(),
  };
}

function inferColumns(row: PositionedText[], sampleNumber: string) {
  const sampleIndex = row.findIndex((item) => item.text.includes(sampleNumber));
  const priceIndex = findLastMoneyIndex(row);
  const before = row.slice(0, Math.max(0, sampleIndex));
  const middle = row.slice(sampleIndex + 1, priceIndex >= 0 ? priceIndex : row.length);
  const split = largestHorizontalGap(middle);
  return {
    account: before.map((item) => item.text).join(" ").trim(),
    identification: middle.slice(0, split).map((item) => item.text).join(" ").trim(),
    sampleType: middle.slice(split).map((item) => item.text).join(" ").trim(),
    price: priceIndex >= 0 ? row.slice(priceIndex).map((item) => item.text).join(" ") : "",
  };
}

function largestHorizontalGap(items: PositionedText[]): number {
  if (items.length < 2) return items.length;
  let bestIndex = Math.ceil(items.length / 2);
  let bestGap = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < items.length; index += 1) {
    const gap = items[index].x - (items[index - 1].x + items[index - 1].width);
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function findLastMoneyIndex(row: PositionedText[]): number {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    MONEY_PATTERN.lastIndex = 0;
    if (MONEY_PATTERN.test(row[index].text)) return index;
  }
  return -1;
}

function lastMoney(value: string): string {
  MONEY_PATTERN.lastIndex = 0;
  const matches = [...value.matchAll(MONEY_PATTERN)];
  return matches.at(-1)?.[0] ?? "";
}

function parseMoney(value: string): number {
  const match = value.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}/)?.[0];
  if (!match) return Number.NaN;
  return Number(match.replace(/\./g, "").replace(",", "."));
}

function extractMoneyAfterLabel(text: string, labels: string[]): number | null {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = normalizeText(lines[index]);
    if (!labels.some((label) => normalized.includes(normalizeText(label)))) continue;
    const sameLine = parseMoney(lines[index]);
    if (Number.isFinite(sameLine)) return sameLine;
    const nextLine = parseMoney(lines[index + 1] ?? "");
    if (Number.isFinite(nextLine)) return nextLine;
  }
  return null;
}

function extractLineValue(text: string, label: string): string {
  const normalizedLabel = normalizeText(label);
  for (const line of text.split("\n")) {
    const normalizedLine = normalizeText(line);
    const position = normalizedLine.indexOf(normalizedLabel);
    if (position < 0) continue;
    const rawPosition = line.toLowerCase().indexOf(label.toLowerCase());
    if (rawPosition >= 0) {
      return line.slice(rawPosition + label.length).replace(/^\s*:?\s*/, "").trim();
    }
    return line.split(":").slice(1).join(":").trim();
  }
  return "";
}

function extractDateAfterLabel(text: string, label: string): string {
  const line = text
    .split("\n")
    .find((candidate) => normalizeText(candidate).includes(normalizeText(label)));
  return line?.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0] ?? "";
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
