import type {
  BillingItem,
  Classification,
  CollectionSample,
  ConferenceSummary,
  PdfMetadata,
  ReconciliationItem,
  Severity,
} from "./types";

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  ok: "Conciliado",
  revision_mismatch: "Revisar versão",
  billing_without_collection: "Cobrado sem coleta",
  collection_without_billing: "Coletado não cobrado",
  data_mismatch: "Dados divergentes",
  duplicate_billing: "Duplicado no PDF",
};

export const CLASSIFICATION_SHORT_LABELS: Record<Classification, string> = {
  ...CLASSIFICATION_LABELS,
  ok: "OK",
};

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function sampleKey(value: unknown): string {
  return fullSampleKey(value)
    .replace(/\.\d+$/, "");
}

function fullSampleKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function sampleBaseKey(value: unknown): string {
  return sampleKey(value);
}

export function textSimilarity(left: unknown, right: unknown): number {
  const leftTokens = new Set(normalizeText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (!leftTokens.size && !rightTokens.size) return 1;

  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common += 1;
  }
  return common / Math.max(leftTokens.size, rightTokens.size, 1);
}

function compareDescriptions(pdf: BillingItem, excel: CollectionSample) {
  const companyMatches = textSimilarity(pdf.account, excel.company) >= 0.55;
  const identificationMatches =
    textSimilarity(pdf.identification, excel.identification) >= 0.55;
  const typeMatches = textSimilarity(pdf.sampleType, excel.sampleType) >= 0.8;

  return {
    companyMatches,
    identificationMatches,
    typeMatches,
    allMatch: companyMatches && identificationMatches && typeMatches,
  };
}

function itemId(index: number, pdfNumber: string | null, excelNumber: string | null) {
  const key = sampleKey(pdfNumber ?? excelNumber ?? "item")
    .replace(/[^A-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${String(index + 1).padStart(4, "0")}-${key || "item"}`;
}

function buildItem(
  index: number,
  classification: Classification,
  severity: Severity,
  pdf: BillingItem | null,
  excel: CollectionSample | null,
  note: string,
): ReconciliationItem {
  const flags = pdf && excel ? compareDescriptions(pdf, excel) : null;
  return {
    id: itemId(index, pdf?.sampleNumber ?? null, excel?.sampleNumber ?? null),
    classification,
    severity,
    pdfSampleNumber: pdf?.sampleNumber ?? null,
    excelSampleNumber: excel?.sampleNumber ?? null,
    pdfCompany: pdf?.account ?? null,
    excelCompany: excel?.company ?? null,
    pdfIdentification: pdf?.identification ?? null,
    excelIdentification: excel?.identification ?? null,
    pdfSampleType: pdf?.sampleType ?? null,
    excelSampleType: excel?.sampleType ?? null,
    pdfPage: pdf?.page ?? null,
    chargedPrice: pdf?.price ?? 0,
    collectionDate: excel?.collectionDate ?? null,
    sampleStatus: excel?.sampleStatus ?? null,
    analysesCount: excel?.analyses.length ?? 0,
    sourceFiles: excel?.sourceFiles ?? [],
    companyMatches: flags?.companyMatches ?? null,
    identificationMatches: flags?.identificationMatches ?? null,
    typeMatches: flags?.typeMatches ?? null,
    note,
    decision: "pending",
    reviewComment: "",
    reviewedBy: null,
    reviewedAt: null,
  };
}

export function reconcileSamples(
  billingItems: BillingItem[],
  collectionSamples: CollectionSample[],
  pdfMetadata: PdfMetadata,
): { items: ReconciliationItem[]; summary: ConferenceSummary } {
  const excelByNumber = new Map<string, CollectionSample>();

  for (const sample of collectionSamples) {
    const key = sampleKey(sample.sampleNumber);
    excelByNumber.set(key, sample);
  }

  const pdfCounts = new Map<string, number>();
  for (const item of billingItems) {
    const key = sampleKey(item.sampleNumber);
    pdfCounts.set(key, (pdfCounts.get(key) ?? 0) + 1);
  }

  const matchedExcel = new Set<string>();
  const items: ReconciliationItem[] = [];

  for (const pdfItem of billingItems) {
    const key = sampleKey(pdfItem.sampleNumber);
    const exact = excelByNumber.get(key) ?? null;
    let excelItem = exact;
    let classification: Classification;
    let severity: Severity;
    let note: string;

    if ((pdfCounts.get(key) ?? 0) > 1) {
      classification = "duplicate_billing";
      severity = "high";
      note = "O mesmo número aparece mais de uma vez na cobrança.";
    } else if (exact) {
      const flags = compareDescriptions(pdfItem, exact);
      const versionDiffers =
        fullSampleKey(pdfItem.sampleNumber) !== fullSampleKey(exact.sampleNumber);
      classification = flags.allMatch ? "ok" : "data_mismatch";
      severity = flags.allMatch ? "low" : "high";
      note = flags.allMatch
        ? versionDiffers
          ? "Número-base e dados descritivos conferem; a versão final após o ponto foi ignorada."
          : "Número-base e dados descritivos conferem."
        : "O número-base confere, mas empresa, identificação ou tipo divergem.";
    } else {
      excelItem = null;
      classification = "billing_without_collection";
      severity = "high";
      note = "Número da amostra não localizado nas planilhas.";
    }

    if (excelItem) matchedExcel.add(sampleKey(excelItem.sampleNumber));
    items.push(
      buildItem(items.length, classification, severity, pdfItem, excelItem, note),
    );
  }

  for (const excelItem of collectionSamples) {
    if (matchedExcel.has(sampleKey(excelItem.sampleNumber))) continue;
    items.push(
      buildItem(
        items.length,
        "collection_without_billing",
        "medium",
        null,
        excelItem,
        "A amostra consta nas planilhas, mas não foi localizada na cobrança.",
      ),
    );
  }

  const count = (classification: Classification) =>
    items.filter((item) => item.classification === classification).length;
  const divergentItems = items.filter((item) => item.classification !== "ok");
  const sourceDuplicates = collectionSamples.reduce(
    (total, sample) => total + Math.max(0, sample.sourceFiles.length - 1),
    0,
  );

  const summary: ConferenceSummary = {
    billingItems: billingItems.length,
    collectedSamples: collectionSamples.length,
    matchedOk: count("ok"),
    revisionMismatches: count("revision_mismatch"),
    billingWithoutCollection: count("billing_without_collection"),
    collectionWithoutBilling: count("collection_without_billing"),
    dataMismatches: count("data_mismatch"),
    duplicateBilling: count("duplicate_billing"),
    sourceDuplicates,
    divergentItems: divergentItems.length,
    reviewedItems: 0,
    pendingReviews: divergentItems.length,
    billedTotal: roundCurrency(
      billingItems.reduce((total, item) => total + item.price, 0),
    ),
    reportedTotal: pdfMetadata.reportedTotal,
    valueUnderReview: roundCurrency(
      divergentItems.reduce((total, item) => total + item.chargedPrice, 0),
    ),
  };

  return { items, summary };
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
