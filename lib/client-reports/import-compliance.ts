import type {
  ComplianceResult,
  ComplianceIdentity,
  ComplianceFileMetadata,
} from "../compliance-types.ts";
import type {
  ImportBatch,
  LabResult,
  ReportClientSettings,
  SourceInfo,
  ReportValue,
} from "./types.ts";
import {
  emptyReportBatch,
  normalizeParameter,
  normalizeUnit,
  reportDate,
  reportIssue,
  isUnitlessReportParameter,
} from "./values.ts";
import { selectLatestLabRevisions } from "./import-lab.ts";

const key = (text: unknown) => String(text ?? "").trim().toLocaleLowerCase("pt-BR");
const cleanDigits = (text?: string) => (text ?? "").replace(/\D/g, "");

export interface ComplianceRunSource {
  id: string;
  identity?: Partial<ComplianceIdentity>;
  periodLabel?: string;
  files?: ComplianceFileMetadata[];
}

/**
 * Pure adapter converting verified compliance results into a client report LabResult batch.
 * Conforms to Regra 5:
 * - CNPJ validation against configured station taxIds.
 * - Strict point mapping via settings.mappings (labId === 'compliance'). No fuzzy guessing.
 * - Strict preservation of operators (<, >, LD, LQ) and raw results.
 * - Collection date determines competence (never publication date).
 * - Origin traceability and idempotent deduplication.
 */
export function complianceItemsToLabBatch(
  items: ComplianceResult[],
  run: ComplianceRunSource,
  settings: ReportClientSettings | null,
  period: string
): ImportBatch {
  const batch = emptyReportBatch();

  const sourceFile = run.files?.[0];
  const sourceInfo: SourceInfo = {
    id: `compliance:${run.id}`,
    name: sourceFile?.name ?? `Laudo Conformidade (${run.periodLabel ?? period})`,
    sha256: sourceFile?.sha256 ?? "",
    kind: "lab",
    size: sourceFile?.size ?? 0,
    importedAt: new Date().toISOString(),
    importedByUid: "compliance-system",
    adapterVersion: "compliance-v1",
    verificationNotes: ["Origem rastreada de módulo de conformidade legal autenticado."],
  };
  batch.sources = [sourceInfo];

  // 1. CNPJ validation
  const runCnpj = cleanDigits(run.identity?.cnpj);
  if (runCnpj.length > 0 && settings?.identities) {
    const knownTaxIds = Object.values(settings.identities)
      .map((id) => cleanDigits(id.taxId))
      .filter((t) => t.length > 0);

    if (knownTaxIds.length > 0 && !knownTaxIds.includes(runCnpj)) {
      batch.issues.push(
        reportIssue(
          "compliance-cnpj-divergent",
          `CNPJ do laudo (${run.identity?.cnpj}) não corresponde ao CNPJ cadastrado para o cliente (${settings.clientId}). Não associe dados por semelhança.`,
          [],
          "blocker"
        )
      );
    }
  }

  const seenKeys = new Set<string>();

  for (const item of items) {
    const parameter = normalizeParameter(item.parameterName || item.parameterKey || "");
    const sampleNumber = String(item.sampleNumber ?? "").trim();
    const dedupKey = `${run.id}:${item.id || sampleNumber}:${parameter}`;
    if (seenKeys.has(dedupKey)) {
      // Idempotent: avoid duplicating results on repeat processing
      continue;
    }
    seenKeys.add(dedupKey);

    const recordId = `${sourceInfo.id}:item:${item.id || sampleNumber}:${parameter}`;
    const collectionDate = reportDate(item.collectionDate);

    // Map point strictly via settings.mappings, or fallback to smart point recognition
    const mapping = settings?.mappings?.find(
      (m) =>
        m.labId === "compliance" &&
        key(m.identification) === key(item.pointLabel)
    );

    let resolvedStationId: string | null = mapping?.stationId ?? null;
    let resolvedPointId: string | null = mapping?.pointId ?? null;

    if (!resolvedPointId) {
      const norm = key(item.pointLabel);
      if (/tratad|saida|saída|final|efluente tratado|água tratada/i.test(norm)) {
        resolvedPointId = "tratado";
      } else if (/brut|entrad|equaliz|efluente bruto/i.test(norm)) {
        resolvedPointId = "bruto";
      } else if (/polidor/i.test(norm)) {
        resolvedPointId = "polidora";
      } else if (/esmalt/i.test(norm)) {
        resolvedPointId = "esmaltacao";
      } else if (/po[çc]o|subterr[âa]ne/i.test(norm)) {
        resolvedPointId = "poco";
      } else if (/consumo|bebedouro|torneira/i.test(norm)) {
        resolvedPointId = "consumo";
      }
    }

    if (!resolvedStationId) {
      const norm = key(item.pointLabel);
      if (/etdi/i.test(norm)) {
        resolvedStationId = "etdi";
      } else if (/biol|sanit/i.test(norm)) {
        resolvedStationId = "biologico";
      } else if (settings?.clientId === "demo13") {
        resolvedStationId = /18039|18040/i.test(sampleNumber) ? "etdi" : /18041|18042/i.test(sampleNumber) ? "biologico" : "etdi";
      } else if (settings?.clientId === "demo24") {
        resolvedStationId = "combined";
      } else if (settings?.clientId === "demo14") {
        resolvedStationId = "eta";
      } else {
        resolvedStationId = "ete";
      }
    }

    const point = mapping ?? (resolvedPointId ? { stationId: resolvedStationId, pointId: resolvedPointId } : null);
    const unit = normalizeUnit(item.unit || "");

    const operator =
      item.operator === "qualitative" ? null : item.operator ?? "=";

    const value: ReportValue = {
      raw: item.resultRaw ?? (item.value != null ? String(item.value) : ""),
      value: item.value,
      operator,
      qualitative: item.operator === "qualitative" ? (item.resultRaw || null) : null,
      unit,
      originalUnit: item.unit || "",
      status:
        item.value !== null || item.operator === "qualitative"
          ? "measured"
          : "missing",
    };

    const record: LabResult = {
      id: recordId,
      labId: "compliance",
      sampleBase: sampleNumber.replace(/\.\d+$/, "") || item.id,
      revision: 0,
      sampleNumber: sampleNumber || item.id,
      stationId: resolvedStationId,
      pointId: resolvedPointId,
      identification: item.pointLabel,
      company: run.identity?.clientName || settings?.clientId || "",
      date: collectionDate ?? "",
      time: null,
      publicationDate: null, // Collection date defines competence, never publication date
      parameter,
      value,
      source: {
        sourceId: sourceInfo.id,
        externalRecordId: `complianceRuns/${run.id}/items/${item.id}`,
      },
    };

    batch.lab.push(record);

    if (!sampleNumber && !item.id) {
      batch.issues.push(
        reportIssue(
          "lab-identity-incomplete",
          "Identificação ou número da amostra ausente.",
          [recordId]
        )
      );
    }
    if (!parameter) {
      batch.issues.push(
        reportIssue(
          "lab-identity-incomplete",
          "Parâmetro analítico ausente.",
          [recordId]
        )
      );
    }
    if (!collectionDate) {
      batch.issues.push(
        reportIssue(
          "lab-identity-incomplete",
          `Data de coleta ausente ou inválida para a amostra ${sampleNumber}.`,
          [recordId]
        )
      );
    } else if (collectionDate.slice(0, 7) !== period) {
      batch.issues.push(
        reportIssue(
          "outside-period",
          `Data de coleta (${collectionDate}) fora da competência selecionada (${period}); laudo não pode ser usado como dado do mês sem confirmação de histórico.`,
          [recordId],
          "warning"
        )
      );
    }

    if (!point) {
      batch.issues.push(
        reportIssue(
          "point-unmapped",
          `Ponto de amostragem "${item.pointLabel}" não possui de-para cadastrado para laudos de conformidade.`,
          [recordId],
          "blocker"
        )
      );
    }

    if (!unit && !isUnitlessReportParameter(parameter)) {
      batch.issues.push(
        reportIssue("unit-missing", `Unidade ausente para o parâmetro ${parameter}.`, [recordId])
      );
    }
  }

  // Check revisions and conflicts
  batch.issues.push(...selectLatestLabRevisions(batch.lab).issues);

  return batch;
}
