import * as XLSX from "xlsx";
import type {
  ImportBatch,
  ImportContext,
  SourceInfo,
  ReportClientId,
  ReportClientSettings,
  LabResult,
} from "./types.ts";
import {
  emptyReportBatch,
  reportDate,
  reportIssue,
  normalizeParameter,
  parseReportValue,
} from "./values.ts";
import { importLabWorkbook, extractDemo13StationPoint } from "./import-lab.ts";
import { importOperationsWorkbook, workbookPeriod, type OperationProfile } from "./import-operations.ts";
import { importStandardWorkbook, STANDARD_HEADERS } from "./manual.ts";
import { importGlobePhotoText } from "./import-demo01-photo-text.ts";
import { parseComplianceFiles } from "../compliance-pdf.ts";
import { complianceItemsToLabBatch } from "./import-compliance.ts";
import { mergeReportImport } from "./editor.ts";

export interface AutoImportResult {
  primaryPeriod: string;
  allPeriodsFound: string[];
  conflictingPeriods: string[];
  stationBatches: { stationId: string; batch: ImportBatch }[];
  sources: SourceInfo[];
  summary: {
    totalFiles: number;
    totalLabRecords: number;
    totalOperationRecords: number;
    stations: string[];
    parameters: string[];
  };
}

export async function fileSha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (x: unknown) =>
  String(x ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const MR_HEADERS = [
  "N° Amostra",
  "Identificação",
  "Empresa Solicitante",
  "Data de Coleta",
  "Identificação da Análise",
  "Resultado da Análise",
];

export function detectWorkbookFormat(workbook: XLSX.WorkBook): string {
  // 1. Check for Standard Workbook
  const standardMatch = Object.keys(STANDARD_HEADERS).some((sheet) =>
    workbook.SheetNames.includes(sheet)
  );
  if (standardMatch) return "standard";

  // 2. Check for MR Lab Workbook
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: null });
    if (
      rows.some((row) =>
        MR_HEADERS.every((h) => row.some((c) => clean(c) === clean(h)))
      )
    ) {
      return "mr-lab";
    }
  }

  // 3. Check for Demo13 History (sheets ETDI, BIOLOGICO with reference parameters)
  const demo13Sheets = workbook.SheetNames.map(clean);
  if (demo13Sheets.some((s) => s.includes("etdi") || s.includes("biologico"))) {
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: null });
      if (
        rows.some(
          (row) =>
            row.some((c) => clean(c) === "parametros") &&
            row.some((c) => clean(c) === "unidade")
        )
      ) {
        return "demo13-history";
      }
    }
  }

  // 4. Check for Hospital Daily Sheets
  const dailySheets = workbook.SheetNames.filter((s) => /^\d{1,2}$/.test(s.trim()));
  if (
    dailySheets.length >= 3 ||
    workbook.SheetNames.some((s) => clean(s).includes("ph biologico") || clean(s).includes("ph saida"))
  ) {
    return "hospital";
  }

  // 5. Check for Demo24 Monitoring or Polidora
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: null });
    if (
      rows.some(
        (row) =>
          row.some((c) => clean(c) === "prensagem" || clean(c) === "polidora") ||
          (row.some((c) => clean(c) === "data") && row.some((c) => /^ph final/.test(clean(c))))
      )
    ) {
      return "demo24";
    }
  }

  // 6. Check for Demo09 Eficiência
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: null });
    const hasDbo = rows.slice(0, 10).some((row) => row.some((c) => clean(c) === "dbo"));
    const hasDqo = rows.slice(0, 10).some((row) => row.some((c) => clean(c) === "dqo"));
    const hasEficiencia = rows.slice(0, 10).some((row) => row.some((c) => /eficiencia|equalizado|decantador/.test(clean(c))));
    if (hasDbo && hasDqo && hasEficiencia) {
      return "demo09-eficiencia";
    }
  }

  // 7. Check for Demo09 Diário (Mensal with Demo09 anchors)
  for (const name of workbook.SheetNames) {
    if (clean(name) === "mensal") {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: null });
      if (rows.slice(0, 10).some((row) => row.some((c) => /elevat[oó]ria|reator|lan[çc]amento/i.test(clean(c))))) {
        return "demo09-diario";
      }
    }
  }

  return "generic";
}

/**
 * Extracts potential dates and months from workbook cells without knowing the format in advance.
 */
function extractDatesFromWorkbook(workbook: XLSX.WorkBook): string[] {
  const dates = new Set<string>();
  const months = ["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: null });

    // Priority 1: If there's an explicit "Data de Coleta" column, prioritize collection dates exclusively
    const headerRow = rows.find((r) => r.some((c) => clean(c) === "data de coleta"));
    if (headerRow) {
      const colIdx = headerRow.findIndex((c) => clean(c) === "data de coleta");
      const startIdx = rows.indexOf(headerRow) + 1;
      for (let r = startIdx; r < rows.length; r++) {
        const cell = rows[r]?.[colIdx];
        if (!cell) continue;
        const d = reportDate(typeof cell === "number" ? cell : !isNaN(Number(cell)) && Number(cell) > 40000 && Number(cell) < 60000 ? Number(cell) : cell);
        if (d && /^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(d)) {
          dates.add(d);
        }
      }
      if (dates.size > 0) {
        return Array.from(dates);
      }
    }

    for (const row of rows.slice(0, 200)) {
      for (const cell of row) {
        if (!cell) continue;
        const s = clean(cell);

        // Check for text month: "setembro de 2026", "09/2026"
        const monthMatch = s.match(/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:\/|de|\s)\s*(20\d{2})/);
        if (monthMatch) {
          const m = String(months.indexOf(monthMatch[1]) + 1).padStart(2, "0");
          dates.add(`${monthMatch[2]}-${m}-01`);
        }

        // Try standard date parsing (both numeric Excel serial and date strings)
        const d = reportDate(typeof cell === "number" ? cell : !isNaN(Number(cell)) && Number(cell) > 40000 && Number(cell) < 60000 ? Number(cell) : cell);
        if (d && /^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(d)) {
          dates.add(d);
        }
      }
    }
  }

  return Array.from(dates);
}

/**
 * Intelligent single and multi-file processing engine.
 * Automatically recognizes formats, dates, competences, stations, and maps points.
 */
export async function autoImportFiles(
  files: File[],
  clientId: ReportClientId,
  settings: ReportClientSettings | null,
  actorUid: string,
  targetPeriod?: string
): Promise<AutoImportResult> {
  if (!files.length) {
    throw new Error("Nenhum arquivo fornecido para importação.");
  }

  const allBatches: ImportBatch[] = [];
  const allSources: SourceInfo[] = [];
  const dateCounts = new Map<string, number>();

  for (const file of files) {
    const fileName = file.name.trim();
    const bytes = await file.arrayBuffer();
    const sha = await fileSha256(bytes);
    const now = new Date().toISOString();

    // 1. PDF Files
    if (/\.pdf$/i.test(fileName)) {
      try {
        const parsedBatch = await parseComplianceFiles([file]);
        if (parsedBatch.results.length > 0) {
          const runId = `pdf-${sha.slice(0, 8)}`;
          const periodGuess = targetPeriod ?? (parsedBatch.results[0]?.collectionDate?.slice(0, 7) || new Date().toISOString().slice(0, 7));
          const compBatch = complianceItemsToLabBatch(
            parsedBatch.results,
            { id: runId, identity: parsedBatch.identity, periodLabel: periodGuess, files: [{ name: fileName, size: file.size, sha256: sha, pages: 1, documentType: "laboratory_report" }] },
            settings,
            periodGuess
          );
          allBatches.push(compBatch);
          allSources.push(...compBatch.sources);

          for (const r of compBatch.lab) {
            const p = r.date.slice(0, 7);
            if (p) dateCounts.set(p, (dateCounts.get(p) ?? 0) + 1);
          }
          continue;
        }
      } catch {
        // If compliance PDF parser didn't match, record as reference attachment
        const refSource: SourceInfo = {
          id: `${sha}:pdf-reference`,
          name: fileName,
          sha256: sha,
          kind: "reference",
          size: file.size,
          importedAt: now,
          importedByUid: actorUid,
          adapterVersion: "pdf-reference-v1",
          verificationNotes: ["Arquivo PDF anexado como documento de referência."],
        };
        const batch = emptyReportBatch();
        batch.sources = [refSource];
        allBatches.push(batch);
        allSources.push(refSource);
        continue;
      }
    }

    // 2. TXT Files (Demo01 photo transcript or text)
    if (/\.txt$/i.test(fileName)) {
      const text = new TextDecoder().decode(bytes);
      let txtPeriod = targetPeriod;
      try {
        const unwrapped = text.replace(/^\uFEFF/,"").trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
        const parsed = JSON.parse(unwrapped);
        if (parsed.competencia) {
          txtPeriod = parsed.competencia;
          dateCounts.set(parsed.competencia, (dateCounts.get(parsed.competencia) ?? 0) + 20);
        }
      } catch {
        // continue
      }

      const effectivePeriod = txtPeriod ?? targetPeriod ?? new Date().toISOString().slice(0, 7);
      const source: SourceInfo = {
        id: `${sha}:demo01-photo-v1`,
        name: fileName,
        sha256: sha,
        kind: "operations",
        size: file.size,
        importedAt: now,
        importedByUid: actorUid,
        adapterVersion: "demo01-photo-v1",
      };
      const context: ImportContext = {
        clientId,
        stationId: "ete",
        period: effectivePeriod,
        actorUid,
        importedAt: now,
        mappings: settings?.mappings,
        demo: process.env.NEXT_PUBLIC_REPORTS_EMULATORS === "true" || process.env.NODE_ENV === "test" || !process.env.NODE_ENV,
      };
      try {
        const demo01 = importGlobePhotoText(text, source, context);
        allBatches.push(demo01.batch);
        allSources.push(source);
        for (const r of [...demo01.batch.lab, ...demo01.batch.operations]) {
          const p = r.date?.slice(0, 7) || effectivePeriod;
          if (p) dateCounts.set(p, (dateCounts.get(p) ?? 0) + 1);
        }
      } catch (e) {
        throw new Error(`Falha ao ler o arquivo de texto ${fileName}: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }

    // 3. Excel and CSV Files (.xlsx, .xls, .csv)
    if (/\.xlsx?$|\.xls$|\.csv$/i.test(fileName)) {
      let workbook: XLSX.WorkBook;
      if (/\.csv$/i.test(fileName)) {
        const text = new TextDecoder("utf-8").decode(bytes);
        workbook = XLSX.read(text, { type: "string", raw: true });
      } else {
        workbook = XLSX.read(bytes, { type: "array" });
      }
      const format = detectWorkbookFormat(workbook);
      const datesFound = extractDatesFromWorkbook(workbook);

      for (const d of datesFound) {
        const p = d.slice(0, 7);
        dateCounts.set(p, (dateCounts.get(p) ?? 0) + 1);
      }

      // Check if any sheet specifies a period header
      let declaredSheetPeriod: string | null = null;
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: null, raw: true });
        const wp = workbookPeriod(rows);
        if (wp) {
          declaredSheetPeriod = wp;
          break;
        }
      }

      // Determine tentative period for context (prioritizing targetPeriod, declared sheet period, or latest date found)
      const latestPeriod = [...dateCounts.keys()].filter(p => p <= new Date().toISOString().slice(0, 7)).sort().reverse()[0]
        ?? [...dateCounts.keys()].sort().reverse()[0];
      const tentativePeriod = targetPeriod ?? declaredSheetPeriod ?? latestPeriod ?? (
        [...dateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
        new Date().toISOString().slice(0, 7)
      );

      const source: SourceInfo = {
        id: `${sha}:${format}:${tentativePeriod}`,
        name: fileName,
        sha256: sha,
        kind: format === "mr-lab" ? "lab" : "operations",
        size: file.size,
        importedAt: now,
        importedByUid: actorUid,
        adapterVersion: `${format}-v1`,
      };

      const context: ImportContext = {
        clientId,
        stationId: clientId === "demo13" ? "etdi" : clientId === "demo24" ? "combined" : clientId === "demo14" ? "eta" : "ete",
        period: tentativePeriod,
        actorUid,
        importedAt: now,
        mappings: settings?.mappings,
      };

      let parsedBatch: ImportBatch;

      if (format === "mr-lab") {
        parsedBatch = importLabWorkbook(workbook, source, context);
      } else if (format === "standard") {
        parsedBatch = importStandardWorkbook(workbook, source, context);
      } else if (format === "demo13-history") {
        parsedBatch = importOperationsWorkbook("demo13-history", workbook, source, context);
      } else if (format === "hospital") {
        parsedBatch = importOperationsWorkbook("hospital", workbook, source, context);
      } else if (format === "demo24") {
        // May contain both polidora and esmaltacao
        const b1 = tryImportOperations("demo24-monitoramento", workbook, source, context);
        const b2 = tryImportOperations("demo24-polidora", workbook, source, context);
        parsedBatch = emptyReportBatch();
        parsedBatch.sources = [source];
        if (b1) {
          parsedBatch.operations.push(...b1.operations);
          parsedBatch.supplies.push(...b1.supplies);
          parsedBatch.issues.push(...b1.issues);
        }
        if (b2) {
          parsedBatch.operations.push(...b2.operations);
          parsedBatch.supplies.push(...b2.supplies);
          parsedBatch.issues.push(...b2.issues);
        }
        if (!b1 && !b2) {
          parsedBatch = importOperationsWorkbook("demo24-monitoramento", workbook, source, context);
        }
      } else if (format === "demo09-eficiencia") {
        parsedBatch = importOperationsWorkbook("demo09-eficiencia", workbook, source, context);
      } else if (format === "demo09-diario") {
        parsedBatch = importOperationsWorkbook("demo09-diario", workbook, source, context);
      } else {
        // Generic fallback: try standard or lab
        try {
          parsedBatch = importStandardWorkbook(workbook, source, context);
        } catch {
          try {
            parsedBatch = importLabWorkbook(workbook, source, context);
          } catch {
            throw new Error(`Não foi possível identificar resultados válidos no arquivo ${fileName}.`);
          }
        }
      }

      allBatches.push(parsedBatch);
      allSources.push(source);

      for (const r of [...parsedBatch.lab, ...parsedBatch.operations]) {
        const p = r.date?.slice(0, 7);
        if (p) dateCounts.set(p, (dateCounts.get(p) ?? 0) + 1);
      }
      continue;
    }

    throw new Error(`Formato de arquivo não suportado: ${fileName}. Utilize Excel (.xlsx, .xls) ou PDF.`);
  }

  // Determine Primary Competence (Competência)
  const sortedPeriods = [...dateCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (!sortedPeriods.length) {
    throw new Error("Não foi possível identificar nenhuma data ou competência nos arquivos importados.");
  }

  const latestPeriod = [...dateCounts.keys()].filter(p => p <= new Date().toISOString().slice(0, 7)).sort().reverse()[0]
    ?? [...dateCounts.keys()].sort().reverse()[0];
  const primaryPeriod = targetPeriod ?? latestPeriod ?? sortedPeriods[0][0];
  const allPeriodsFound = sortedPeriods.map((p) => p[0]).sort();

  // Check for conflicting competences that are not merely historical comparison months
  // Historical comparison is typically 1 or 2 months prior: e.g. primary = 2026-09, prior = 2026-08, 2026-07
  const conflictingPeriods: string[] = [];
  for (const period of allPeriodsFound) {
    if (period === primaryPeriod) continue;
    const [pYear, pMonth] = primaryPeriod.split("-").map(Number);
    const [year, month] = period.split("-").map(Number);
    const diff = (pYear - year) * 12 + (pMonth - month);
    // If diff is outside 1..3 months prior, or if period is in the future, it's conflicting
    if (diff < 0 || diff > 3) {
      conflictingPeriods.push(period);
    }
  }

  // Merge all batches
  let combinedBatch = emptyReportBatch();
  combinedBatch.sources = allSources;
  for (const b of allBatches) {
    combinedBatch = {
      sources: [...combinedBatch.sources, ...b.sources.filter((s) => !combinedBatch.sources.some((cs) => cs.id === s.id))],
      lab: [...combinedBatch.lab, ...b.lab],
      operations: [...combinedBatch.operations, ...b.operations],
      meters: [...combinedBatch.meters, ...b.meters],
      supplies: [...combinedBatch.supplies, ...b.supplies],
      journal: [...combinedBatch.journal, ...b.journal],
      issues: [...combinedBatch.issues, ...b.issues],
    };
  }

  // Add issue if conflicting periods found
  if (conflictingPeriods.length > 0) {
    combinedBatch.issues.push(
      reportIssue(
        "conflicting-competence",
        `Os arquivos contêm dados de competências diferentes (${[primaryPeriod, ...conflictingPeriods].join(", ")}). O relatório foi gerado para a competência predominante (${primaryPeriod}), sem misturar períodos silenciosamente.`,
        [],
        "warning"
      )
    );
  }

  // Group by station
  const stationBatches = groupBatchByStation(combinedBatch, clientId, primaryPeriod);

  const parameters = new Set<string>();
  const stations = new Set<string>();
  for (const r of combinedBatch.lab) {
    if (r.parameter) parameters.add(r.parameter);
    if (r.stationId) stations.add(r.stationId);
  }
  for (const r of combinedBatch.operations) {
    if (r.parameter) parameters.add(r.parameter);
    if (r.stationId) stations.add(r.stationId);
  }

  return {
    primaryPeriod,
    allPeriodsFound,
    conflictingPeriods,
    stationBatches,
    sources: combinedBatch.sources,
    summary: {
      totalFiles: files.length,
      totalLabRecords: combinedBatch.lab.length,
      totalOperationRecords: combinedBatch.operations.length,
      stations: Array.from(stations),
      parameters: Array.from(parameters),
    },
  };
}

function tryImportOperations(
  profile: OperationProfile,
  workbook: XLSX.WorkBook,
  source: SourceInfo,
  context: ImportContext
): ImportBatch | null {
  try {
    return importOperationsWorkbook(profile, workbook, source, context);
  } catch {
    return null;
  }
}

function groupBatchByStation(
  batch: ImportBatch,
  clientId: ReportClientId,
  period: string
): { stationId: string; batch: ImportBatch }[] {
  if (clientId === "demo13") {
    const hasEtdi = batch.lab.some((r) => r.stationId === "etdi" || /etdi/i.test(r.identification || "")) ||
      batch.operations.some((r) => r.stationId === "etdi");
    const hasBio = batch.lab.some((r) => r.stationId === "biologico" || /biologico/i.test(r.identification || "")) ||
      batch.operations.some((r) => r.stationId === "biologico");

    const result: { stationId: string; batch: ImportBatch }[] = [];

    if (hasEtdi || (!hasEtdi && !hasBio)) {
      const etdiBatch = filterBatchForStation(batch, "etdi");
      result.push({ stationId: "etdi", batch: etdiBatch });
    }
    if (hasBio) {
      const bioBatch = filterBatchForStation(batch, "biologico");
      result.push({ stationId: "biologico", batch: bioBatch });
    }
    return result;
  }

  const defaultStation = clientId === "demo24" ? "combined" : clientId === "demo14" ? "eta" : "ete";
  return [{ stationId: defaultStation, batch }];
}

function filterBatchForStation(batch: ImportBatch, stationId: string): ImportBatch {
  return {
    sources: batch.sources,
    lab: batch.lab.filter((r) => !r.stationId || r.stationId === stationId || new RegExp(stationId, "i").test(r.identification || "")),
    operations: batch.operations.filter((r) => !r.stationId || r.stationId === stationId),
    meters: batch.meters.filter((r: any) => !r.stationId || r.stationId === stationId),
    supplies: batch.supplies.filter((r) => !r.stationId || r.stationId === stationId),
    journal: batch.journal,
    issues: batch.issues,
  };
}
