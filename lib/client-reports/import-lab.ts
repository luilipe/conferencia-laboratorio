import * as XLSX from "xlsx";
import type { ImportBatch, ImportContext, SourceInfo, LabResult, ReportIssue } from "./types.ts";
import { emptyReportBatch, normalizeParameter, parseReportValue, reportDate, reportTime, reportIssue, isUnitlessReportParameter } from "./values.ts";

const headers = ["N° Amostra", "Identificação", "Empresa Solicitante", "Data de Coleta", "Identificação da Análise", "Resultado da Análise"];
const key = (text: unknown) => String(text ?? "").trim().toLocaleLowerCase("pt-BR");

export function extractDemo13StationPoint(identification: unknown): { stationId: string; pointId: string } | null {
  const match = key(identification).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .match(/^(etdi|biologico)\s*[-–—]\s*(bruto|tratado)(?:\s*\([^()]+\))?$/);
  return match ? { stationId: match[1], pointId: match[2] } : null;
}

export function importLabWorkbook(workbook: XLSX.WorkBook, source: SourceInfo, context: ImportContext): ImportBatch {
  const batch = emptyReportBatch(); batch.sources = [{ ...source, importedByUid: context.actorUid, adapterVersion: "mr-v2" }];
  let found = false;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    const headerIndex = rows.findIndex(row => headers.every(h => row.some(c => key(c) === key(h))));
    if (headerIndex < 0) continue;
    found = true;
    const head = rows[headerIndex].map(key);
    const cell = (row: unknown[], h: string) => row[head.indexOf(key(h))];
    const valueColumn = head.indexOf(key("Resultado da Análise"));
    rows.slice(headerIndex + 1).forEach((row, offset) => {
      const sampleNumber = String(cell(row,"N° Amostra") ?? "").trim();
      const parameter = normalizeParameter(String(cell(row,"Identificação da Análise") ?? ""));
      if (!sampleNumber && !parameter) return;
      const id = `${source.id}:lab:${sheetName}:${headerIndex + offset + 2}`;
      const identification = String(cell(row,"Identificação") ?? "").trim();
      const company = String(cell(row,"Empresa Solicitante") ?? "").trim();
      const map = context.mappings?.find(m => m.labId === "mr-ambiental" && key(m.identification) === key(identification) && key(m.companyAlias) === key(company));
      const point = map ?? (context.clientId === "demo13" && /^demo13(?:\s|$)/.test(key(company)) ? extractDemo13StationPoint(identification) : null);
      const unit = String(cell(row,"Unidade de Medida da Análise") ?? "");
      const revisionMatch = sampleNumber.match(/\.(\d+)$/);
      const raw = cell(row,"Resultado da Análise");
      const address = XLSX.utils.encode_cell({r: headerIndex + offset + 1, c: valueColumn});
      const excel = sheet[address];
      const value = parseReportValue(excel?.t === "e" ? excel.w || "#ERRO!" : excel?.f && excel.v == null ? "#SEM_VALOR_CALCULADO!" : raw, unit);
      const date = reportDate(cell(row,"Data de Coleta"));
      const record: LabResult = { id, labId:"mr-ambiental", sampleBase: sampleNumber.replace(/\.\d+$/, ""), revision: Number(revisionMatch?.[1] ?? 0), sampleNumber, stationId:point?.stationId ?? null, pointId:point?.pointId ?? null, identification, company, date:date ?? "", time: reportTime(cell(row,"Data de Coleta")), publicationDate: reportDate(cell(row,"Data de Publicação")), parameter, value, source:{sourceId:source.id,sheet:sheetName,cell:address} };
      batch.lab.push(record);
      if (!sampleNumber || !parameter || !date || !company || !identification) batch.issues.push(reportIssue("lab-identity-incomplete","Identificação, amostra, coleta ou parâmetro incompleto.",[id]));
      if (!point) batch.issues.push(reportIssue("point-unmapped",`Confirme a estação e o ponto de ${identification || sampleNumber}.`,[id]));
      if (!unit && !isUnitlessReportParameter(parameter)) batch.issues.push(reportIssue("unit-missing",`Unidade ausente: ${parameter}.`,[id]));
      if (date && date.slice(0,7) !== context.period) batch.issues.push(reportIssue("outside-period","Coleta fora da competência selecionada; selecione explicitamente como histórico ou exclua.",[id],"warning"));
    });
  }
  if (!found) throw new Error("Cabeçalho laboratorial MR não reconhecido. Confira as colunas obrigatórias.");
  batch.issues.push(...selectLatestLabRevisions(batch.lab).issues);
  return batch;
}
export function selectLatestLabRevisions(results: LabResult[]): { active: LabResult[]; issues: ReportIssue[] } {
  const groups = new Map<string, LabResult[]>();
  for (const r of results) { const k = `${r.labId}:${r.sampleBase}`; groups.set(k,[...(groups.get(k) ?? []),r]); }
  const active: LabResult[] = [], issues: ReportIssue[] = [];
  for (const rows of groups.values()) {
    const highest = Math.max(...rows.map(r => r.revision));
    const latest = rows.filter(r => r.revision === highest);
    const older = rows.filter(r => r.revision < highest);
    if (older.some(r => !latest.some(n => n.parameter === r.parameter))) issues.push(reportIssue("revision-incomplete","Revisão mais recente incompleta. Escolha o laudo, sem combinar revisões.",latest.map(r=>r.id)));
    const byParameter = new Map<string, LabResult[]>();
    latest.forEach(r => byParameter.set(r.parameter,[...(byParameter.get(r.parameter) ?? []),r]));
    for (const duplicates of byParameter.values()) {
      if (duplicates.length > 1 && duplicates.some(r => JSON.stringify(r.value) !== JSON.stringify(duplicates[0].value))) issues.push(reportIssue("lab-conflict","Resultados conflitantes na mesma amostra, parâmetro e revisão.",duplicates.map(r=>r.id)));
      active.push(...duplicates);
    }
  }
  return { active, issues };
}
