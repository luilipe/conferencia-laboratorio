import { DEFAULT_ANALYSIS_CLIENT_RULES } from "./analysis-client-rules.ts";
import {
  buildAnalysisClientRuleId,
  canonicalCompanyName,
  resolveAnalysisClientRule,
} from "./analysis-client-matching.ts";
import type {
  AnalysisClientResolution,
  AnalysisClientRule,
  AnalysisNotionProvisioningDraft,
  AnalysisNotionProvisioningRequest,
  AnalysisNotionSettings,
  AnalysisAutomaticPartition,
  AnalysisCompetenceConflict,
  AnalysisPeriodicity,
  AnalysisScheduleGroup,
  AnalysisSchedulePreview,
  AnalysisType,
  NotionSchedulePayload,
  PendingAnalysisReport,
  StoredAnalysisSample,
} from "./analysis-schedule-types.ts";
import { normalizeText, sampleKey } from "./reconciliation.ts";
import type { CollectionSample } from "./types.ts";

export function buildAnalysisSchedulePreview(
  existing: StoredAnalysisSample[],
  incoming: CollectionSample[],
  competence: string,
): AnalysisSchedulePreview {
  const existingByKey = new Map(existing.map((sample) => [sample.sampleKey, sample]));
  const inserted: CollectionSample[] = [];
  const updated: CollectionSample[] = [];
  const unchanged: CollectionSample[] = [];
  const outsideCompetence: CollectionSample[] = [];

  for (const sample of incoming) {
    const key = sampleKey(sample.sampleNumber);
    const previous = existingByKey.get(key);
    if (!previous) inserted.push(sample);
    else if (sameSample(previous, sample)) unchanged.push(sample);
    else updated.push(sample);

    const month = dateMonthKey(sample.collectionDate);
    if (month && month !== competence) outsideCompetence.push(sample);
  }

  const merged = new Map<string, CollectionSample>();
  for (const sample of existing) merged.set(sample.sampleKey, toCollectionSample(sample));
  for (const sample of incoming) merged.set(sampleKey(sample.sampleNumber), sample);

  return {
    inserted,
    updated,
    unchanged,
    outsideCompetence,
    mergedSamples: [...merged.values()].sort((left, right) =>
      left.company.localeCompare(right.company, "pt-BR")
      || left.sampleNumber.localeCompare(right.sampleNumber, "pt-BR"),
    ),
  };
}

export function inferDominantCompetence(samples: CollectionSample[]): string {
  return partitionSamplesByCollectionMonth(samples).months
    .sort((left, right) => right.samples.length - left.samples.length)[0]?.competence ?? "";
}

export function collectionDateCompetence(value: string): string {
  return dateMonthKey(value);
}

export function partitionSamplesByCollectionMonth(
  samples: CollectionSample[],
): AnalysisAutomaticPartition {
  const grouped = new Map<string, CollectionSample[]>();
  const invalidSamples: CollectionSample[] = [];
  for (const sample of samples) {
    const month = collectionDateCompetence(sample.collectionDate);
    if (!month) {
      invalidSamples.push(sample);
      continue;
    }
    const group = grouped.get(month) ?? [];
    group.push(sample);
    grouped.set(month, group);
  }
  return {
    months: [...grouped.entries()]
      .map(([competence, groupedSamples]) => ({ competence, samples: groupedSamples }))
      .sort((left, right) => left.competence.localeCompare(right.competence)),
    invalidSamples,
  };
}

export function findAnalysisCompetenceConflicts(
  partition: AnalysisAutomaticPartition,
  existingLocations: Map<string, string>,
): AnalysisCompetenceConflict[] {
  const conflicts: AnalysisCompetenceConflict[] = [];
  for (const month of partition.months) {
    for (const sample of month.samples) {
      const existingCompetence = existingLocations.get(sampleKey(sample.sampleNumber));
      if (existingCompetence && existingCompetence !== month.competence) {
        conflicts.push({
          sampleNumber: sample.sampleNumber,
          collectionDate: sample.collectionDate,
          detectedCompetence: month.competence,
          existingCompetence,
        });
      }
    }
  }
  return conflicts;
}

export function groupAnalysisScheduleSamples(
  samples: Array<CollectionSample | StoredAnalysisSample>,
  rules: AnalysisClientRule[] = DEFAULT_ANALYSIS_CLIENT_RULES,
): AnalysisScheduleGroup[] {
  const grouped = new Map<string, {
    rule: AnalysisClientRule | null;
    resolution: AnalysisClientResolution;
    company: string;
    type: AnalysisType;
    periodicity: AnalysisPeriodicity;
    samples: Array<CollectionSample | StoredAnalysisSample>;
    warnings: Set<string>;
  }>();

  for (const sample of samples) {
    const type = classifyAnalysisType(sample);
    const periodicity = classifyPeriodicity(sample);
    const resolution = resolveAnalysisClientRule(sample, type, periodicity, rules);
    const key = resolution.rule?.id
      ?? `unmatched:${normalizeText(sample.company)}:${type}:${periodicity}`;
    const current = grouped.get(key) ?? {
      rule: resolution.rule,
      resolution,
      company: sample.company,
      type,
      periodicity,
      samples: [],
      warnings: new Set<string>(),
    };
    current.samples.push(sample);
    for (const warning of resolution.warnings) current.warnings.add(warning);
    grouped.set(key, current);
  }

  return [...grouped.entries()].map(([id, group]) => {
    const collectionDates = uniqueDates(group.samples.map((sample) => sample.collectionDate));
    const publishedDates = uniqueDates(group.samples.map((sample) => sample.publicationDate));
    const publishedCount = group.samples.filter((sample) => Boolean(dateOnly(sample.publicationDate))).length;
    const publicationStatus = publishedCount === group.samples.length
      ? "Publicado"
      : publishedCount > 0
        ? "Parcialmente publicado"
        : "Pendente";

    if (collectionDates.length > 1) group.warnings.add("Há mais de uma data de coleta no agrupamento.");
    if (publicationStatus === "Parcialmente publicado") {
      group.warnings.add("Parte das amostras ainda não foi publicada.");
    }

    return {
      id,
      clientTitle: group.rule?.title ?? group.company,
      notionUrl: group.rule?.notionUrl ?? "",
      sourceCompany: group.company,
      analysisType: group.type,
      periodicity: group.periodicity,
      collectionDates,
      publicationDate: publicationStatus === "Publicado" ? publishedDates.at(-1) ?? "" : "",
      publicationStatus,
      sampleNumbers: [...new Set(group.samples.map((sample) => sample.sampleNumber))]
        .sort((left, right) => left.localeCompare(right, "pt-BR")),
      warnings: [...group.warnings],
      resolutionStatus: group.resolution.status,
      resolutionMethod: group.resolution.method,
      matchConfidence: group.resolution.confidence,
      candidateTitles: group.resolution.candidates.map((candidate) => candidate.title),
      safeForNotion: group.resolution.status === "matched",
      lastUploadId: latestUploadId(group.samples),
      uploadIds: [...new Set(group.samples.map((sample) => "lastUploadId" in sample ? sample.lastUploadId : "").filter(Boolean))],
    } satisfies AnalysisScheduleGroup;
  }).sort((left, right) =>
    left.clientTitle.localeCompare(right.clientTitle, "pt-BR")
    || left.analysisType.localeCompare(right.analysisType, "pt-BR")
    || left.periodicity.localeCompare(right.periodicity, "pt-BR"),
  );
}

export function buildAnalysisNotionProvisioningDrafts(
  competence: string,
  groups: AnalysisScheduleGroup[],
): AnalysisNotionProvisioningDraft[] {
  return groups
    .filter((group) => group.resolutionStatus === "unmatched")
    .map((group) => {
      const proposedTitle = buildNotionClientTitle(group);
      const provisioningKey = [
        competence,
        canonicalCompanyName(group.sourceCompany),
        group.analysisType,
        group.periodicity,
      ].join(":");
      return {
        id: buildAnalysisClientRuleId(provisioningKey),
        provisioningKey,
        competence,
        proposedRuleId: buildAnalysisClientRuleId(proposedTitle),
        sourceCompany: group.sourceCompany,
        proposedTitle,
        analysisType: group.analysisType,
        periodicity: group.periodicity,
        sampleNumbers: group.sampleNumbers,
        uploadIds: group.uploadIds,
        collectionDates: group.collectionDates,
        publicationDate: group.publicationDate,
        publicationStatus: group.publicationStatus,
        currentTarget: { status: "pending" },
        templateTarget: { status: "pending" },
        catalogStatus: "pending",
        promptVersion: 1,
      } satisfies AnalysisNotionProvisioningDraft;
    });
}

export function buildAutomaticAnalysisClientRule(
  draft: AnalysisNotionProvisioningDraft,
  existing?: AnalysisClientRule,
): AnalysisClientRule {
  const sourceCompany = draft.sourceCompany.trim();
  const companyKey = canonicalCompanyName(sourceCompany);
  return {
    id: existing?.id || draft.proposedRuleId,
    title: existing?.title.trim() || draft.proposedTitle,
    notionUrl: existing?.notionUrl ?? "",
    aliases: uniqueTextValues([...(existing?.aliases ?? []), sourceCompany]),
    companyKeys: uniqueTextValues([...(existing?.companyKeys ?? []), companyKey]),
    analysisType: existing?.analysisType ?? draft.analysisType,
    periodicity: existing?.periodicity ?? draft.periodicity,
    qualifiers: existing?.qualifiers ?? {},
    active: existing?.active ?? true,
    updatedAt: existing?.updatedAt,
    updatedByUid: existing?.updatedByUid,
    updatedByName: existing?.updatedByName,
  };
}

export function generateNotionScheduleText(options: {
  competence: string;
  groups: AnalysisScheduleGroup[];
  mode?: "all" | "published" | "pending" | "last-import";
  lastUploadId?: string;
  provisioningRequests?: AnalysisNotionProvisioningRequest[];
  notionSettings?: AnalysisNotionSettings;
}): NotionSchedulePayload {
  const mode = options.mode ?? "all";
  const lastUploadId = options.lastUploadId;
  const filteredGroups = options.groups.filter((group) => {
    if (mode === "published") return group.publicationStatus === "Publicado";
    if (mode === "pending") return group.publicationStatus !== "Publicado";
    if (mode === "last-import") return Boolean(lastUploadId) && group.uploadIds.includes(lastUploadId!);
    return true;
  });
  const safeGroups = filteredGroups.filter((group) => group.safeForNotion);
  const creationGroups = filteredGroups.filter((group) => group.resolutionStatus === "unmatched");
  const blockedGroups = filteredGroups.filter((group) =>
    group.resolutionStatus === "suggested" || group.resolutionStatus === "ambiguous",
  );
  const persistedRequests = (options.provisioningRequests ?? [])
    .filter((request) => request.competence === options.competence)
    .filter((request) => {
      if (mode === "published") return request.publicationStatus === "Publicado";
      if (mode === "pending") return request.publicationStatus !== "Publicado";
      if (mode === "last-import") return Boolean(lastUploadId) && request.uploadIds.includes(lastUploadId!);
      return true;
    });
  const currentPendingRuleIds = new Set(persistedRequests
    .filter((request) => request.currentTarget.status !== "found" && request.currentTarget.status !== "created")
    .map((request) => request.ruleId)
    .filter(Boolean));
  const groups = safeGroups.filter((group) => !currentPendingRuleIds.has(group.id));
  const persistedKeys = new Set(persistedRequests.map((request) => request.provisioningKey));
  const untrackedCreationGroups = creationGroups.filter((group) => {
    const [draft] = buildAnalysisNotionProvisioningDrafts(options.competence, [group]);
    return draft && !persistedKeys.has(draft.provisioningKey);
  });
  const provisioningItems = options.provisioningRequests
    ? [
        ...persistedRequests.map(provisioningItemFromRequest),
        ...untrackedCreationGroups.map(provisioningItemFromGroup),
      ]
    : creationGroups.map(provisioningItemFromGroup);
  const currentProvisioning = provisioningItems.filter((item) =>
    item.currentStatus === "pending" || item.currentStatus === "failed",
  );
  const templateProvisioning = provisioningItems.filter((item) =>
    item.templateStatus === "pending" || item.templateStatus === "failed",
  );
  const blockedProvisioning = provisioningItems.filter((item) =>
    item.currentStatus === "blocked" || item.templateStatus === "blocked",
  );
  const currentDatabase = options.notionSettings?.competenceDatabases[options.competence];
  const templateName = options.notionSettings?.templateDatabaseName.trim()
    || "modelo do acompanhamento de análises";
  const templateUrl = options.notionSettings?.templateDatabaseUrl.trim() || "";
  const lines = [
    `Atualize a relação de análises da competência ${formatCompetence(options.competence)}.`,
    "",
    "Regras:",
    "- Para cada item, procure primeiro um registro com o mesmo Cliente, Tipo de análise e Periodicidade.",
    "- Atualize os registros existentes e crie somente os itens indicados na seção de novos registros quando não houver correspondência.",
    "- Use Coleta para a data de coleta e Liberação do laudo para a data de publicação.",
    "- Não invente datas para itens pendentes ou parcialmente publicados.",
    "- Não altere o tipo de análise nem a periodicidade.",
    "- Ao terminar, informe separadamente os registros atualizados, criados e não processados.",
    "",
    "REGISTROS EXISTENTES — ATUALIZAR:",
  ];

  if (!groups.length) lines.push("- Nenhum registro existente corresponde ao filtro selecionado.");
  for (const group of groups) {
    lines.push(
      `- ${group.clientTitle}`,
      `  Tipo de análise: ${group.analysisType}`,
      `  Periodicidade: ${group.periodicity}`,
      `  Coleta: ${group.collectionDates.join(", ") || "não localizada"}`,
      `  Liberação do laudo: ${group.publicationDate || group.publicationStatus.toLowerCase()}`,
    );
  }

  lines.push(
    "",
    `NOVOS REGISTROS — LOCALIZAR OU CRIAR NA BASE ATUAL${currentDatabase?.name ? ` (${currentDatabase.name})` : ""}:`,
  );
  if (currentDatabase?.url) lines.push(`- Destino: ${currentDatabase.url}`);
  if (!currentProvisioning.length) lines.push("- Nenhum novo registro precisa ser criado na base atual.");
  else {
    lines.push(
      "- Estes clientes originaram uma solicitação de cadastro. Pesquise novamente na base atual do Notion antes de criar para evitar duplicidade.",
      "- Use como identidade a combinação Cliente + Tipo de análise + Periodicidade.",
      "- Se já existir uma linha equivalente, atualize-a. Se não existir, crie uma nova linha e preencha exatamente as propriedades abaixo.",
      "- Quando o valor indicado for 'deixar em branco', não estime nem copie outra data.",
    );
  }
  for (const item of currentProvisioning) {
    lines.push(
      `- Cliente: ${item.title}`,
      "  Ação: localizar a linha equivalente; se não existir, criar",
      `  Tipo de nota: ${notionNoteType(item.periodicity)}`,
      "  Nota: marcar a caixa",
      `  Coleta: ${item.collectionDates.join(", ") || "deixar em branco"}`,
      "  Envio ao Laboratório: deixar em branco",
      `  Liberação do laudo: ${item.publicationDate || "deixar em branco"}`,
      "  Envio ao Cliente: deixar em branco",
      `  Periodicidade: ${item.periodicity}`,
      `  Tipo de análise: ${item.analysisType}`,
    );
  }

  lines.push("", `NOVOS REGISTROS — LOCALIZAR OU CRIAR NO MODELO (${templateName}):`);
  if (templateUrl) lines.push(`- Destino: ${templateUrl}`);
  if (!templateProvisioning.length) lines.push("- Nenhum novo registro precisa ser criado no modelo.");
  else {
    lines.push(
      "- Pesquise no modelo antes de criar. Use como identidade Cliente + Tipo de análise + Periodicidade.",
      "- Se já existir um item equivalente, mantenha apenas um registro e não duplique.",
      "- O modelo não deve receber datas operacionais desta competência.",
    );
  }
  for (const item of templateProvisioning) {
    lines.push(
      `- Cliente: ${item.title}`,
      "  Ação: localizar a linha equivalente; se não existir, criar",
      `  Tipo de nota: ${notionNoteType(item.periodicity)}`,
      "  Nota: marcar a caixa",
      "  Coleta: deixar em branco",
      "  Envio ao Laboratório: deixar em branco",
      "  Liberação do laudo: deixar em branco",
      "  Envio ao Cliente: deixar em branco",
      `  Periodicidade: ${item.periodicity}`,
      `  Tipo de análise: ${item.analysisType}`,
    );
  }
  if (blockedProvisioning.length) {
    lines.push(
      "",
      "ITENS NÃO PROCESSADOS:",
      "- Os itens abaixo estão bloqueados. Não crie novos registros até que a ambiguidade seja revisada.",
      ...blockedProvisioning.map((item) => `- ${item.title} · ${item.analysisType} · ${item.periodicity}`),
    );
  }
  lines.push(
    "",
    "RELATÓRIO FINAL:",
    "- Informe separadamente, para a base atual e para o modelo, os itens localizados, criados e não processados.",
    "- Inclua o link do registro quando estiver disponível.",
  );
  return {
    text: lines.join("\n"),
    includedGroups: groups,
    creationGroups,
    blockedGroups,
    provisioningRequests: persistedRequests,
  };
}

export function buildPendingAnalysisReport(options: {
  competence: string;
  samples: Array<CollectionSample | StoredAnalysisSample>;
  generatedBy: string;
  generatedAt?: Date;
  rules?: AnalysisClientRule[];
}): PendingAnalysisReport {
  const groups = groupAnalysisScheduleSamples(options.samples, options.rules);
  const clientBySample = new Map<string, string>();
  for (const group of groups) {
    for (const number of group.sampleNumbers) clientBySample.set(sampleKey(number), group.clientTitle);
  }
  const rows = options.samples
    .filter(isPendingSample)
    .map((sample) => ({
      sampleNumber: sample.sampleNumber,
      client: clientBySample.get(sampleKey(sample.sampleNumber)) || cleanSourceCompany(sample.company),
      collectionDate: dateOnly(sample.collectionDate),
      identification: sample.identification || "Não informada",
      situation: sample.sampleStatus || "Pendente",
    }))
    .sort((left, right) => compareDate(left.collectionDate, right.collectionDate)
      || left.client.localeCompare(right.client, "pt-BR")
      || left.sampleNumber.localeCompare(right.sampleNumber, "pt-BR"));
  const generatedAt = options.generatedAt ?? new Date();
  return {
    competence: options.competence,
    competenceLabel: analysisScheduleMonthLabel(options.competence),
    generatedAt: generatedAt.toISOString(),
    generatedBy: options.generatedBy,
    total: rows.length,
    rows,
  };
}

export function generateWhatsAppPendingText(report: PendingAnalysisReport): string {
  const lines = [
    `*PENDÊNCIAS DE LAUDOS - ${report.competenceLabel.toLocaleUpperCase("pt-BR")}*`,
    "",
    `Total de amostras pendentes: *${report.total}*`,
    "",
  ];
  if (!report.rows.length) {
    lines.push("Não há análises pendentes nesta competência.");
  } else {
    for (const row of report.rows) {
      lines.push(
        `• *${row.sampleNumber}*`,
        `  Cliente: ${row.client}`,
        `  Coleta: ${row.collectionDate || "não informada"}`,
        `  Identificação: ${row.identification}`,
        `  Situação: ${row.situation}`,
        "",
      );
    }
    lines.push("Por gentileza, verificar a situação e a liberação dos respectivos laudos.");
  }
  return lines.join("\n").trim();
}

export function analysisScheduleMonthLabel(monthKey: string): string {
  const match = monthKey.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function analysisSampleDocumentId(value: string): string {
  return encodeURIComponent(sampleKey(value));
}

function classifyAnalysisType(sample: CollectionSample): AnalysisType {
  const identification = normalizeText(sample.identification);
  const analyses = normalizeText(sample.analyses.join(" "));
  const type = normalizeText(sample.sampleType);
  if (identification.includes("polidora") || analyses.includes("polidora")) return "Polidora";
  if (identification.includes("extra")) return "Extra";
  if (type.includes("residual") || identification.includes("efluente") || identification.includes("etdi")) {
    return "Efluente";
  }
  return "Água";
}

function classifyPeriodicity(sample: CollectionSample): AnalysisPeriodicity {
  const value = normalizeText(`${sample.identification} ${sample.analyses.join(" ")}`);
  if (value.includes("semestral")) return "Semestral";
  if (value.includes("sem periodicidade")) return "Sem periodicidade";
  return "Mensal";
}

function sameSample(left: CollectionSample, right: CollectionSample): boolean {
  const comparable = (sample: CollectionSample) => ({
    sampleNumber: sample.sampleNumber,
    code: sample.code,
    proposal: sample.proposal,
    identification: sample.identification,
    sampleType: sample.sampleType,
    company: sample.company,
    collectionDate: sample.collectionDate,
    publicationDate: sample.publicationDate,
    opinion: sample.opinion,
    sampleStatus: sample.sampleStatus,
    analyses: [...sample.analyses].sort(),
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function toCollectionSample(sample: StoredAnalysisSample): CollectionSample {
  return {
    sampleNumber: sample.sampleNumber,
    code: sample.code,
    proposal: sample.proposal,
    identification: sample.identification,
    sampleType: sample.sampleType,
    company: sample.company,
    collectionDate: sample.collectionDate,
    publicationDate: sample.publicationDate,
    opinion: sample.opinion,
    sampleStatus: sample.sampleStatus,
    analyses: sample.analyses,
    sourceFiles: sample.sourceFiles,
    sourceRows: sample.sourceRows,
  };
}

function dateMonthKey(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(20\d{2})/);
  return match ? `${match[3]}-${match[2]}` : "";
}

function dateOnly(value: string): string {
  return value.match(/^\d{2}\/\d{2}\/20\d{2}/)?.[0] ?? "";
}

function isPendingSample(sample: CollectionSample): boolean {
  const status = normalizeText(sample.sampleStatus);
  return !dateOnly(sample.publicationDate) || status !== "publicada";
}

function cleanSourceCompany(value: string): string {
  return value.replace(/\s*-\s*Ouro Fino\s*$/i, "").trim() || "Cliente não informado";
}

export function buildNotionClientTitle(group: AnalysisScheduleGroup): string {
  const company = cleanSourceCompany(group.sourceCompany).toLocaleUpperCase("pt-BR");
  const typeSuffix = group.analysisType.toLocaleUpperCase("pt-BR");
  const periodicitySuffix = group.periodicity === "Semestral" ? " SEMESTRAL" : "";
  const expectedSuffix = `${typeSuffix}${periodicitySuffix}`;
  const normalizedCompany = normalizeText(company);
  const normalizedSuffix = normalizeText(expectedSuffix);
  return normalizedCompany.endsWith(normalizedSuffix)
    ? company
    : `${company} - ${expectedSuffix}`;
}

interface NotionProvisioningItem {
  title: string;
  analysisType: AnalysisType;
  periodicity: AnalysisPeriodicity;
  collectionDates: string[];
  publicationDate: string;
  currentStatus: AnalysisNotionProvisioningRequest["currentTarget"]["status"];
  templateStatus: AnalysisNotionProvisioningRequest["templateTarget"]["status"];
}

function provisioningItemFromRequest(request: AnalysisNotionProvisioningRequest): NotionProvisioningItem {
  return {
    title: request.proposedTitle,
    analysisType: request.analysisType,
    periodicity: request.periodicity,
    collectionDates: request.collectionDates,
    publicationDate: request.publicationDate,
    currentStatus: request.currentTarget.status,
    templateStatus: request.templateTarget.status,
  };
}

function provisioningItemFromGroup(group: AnalysisScheduleGroup): NotionProvisioningItem {
  return {
    title: buildNotionClientTitle(group),
    analysisType: group.analysisType,
    periodicity: group.periodicity,
    collectionDates: group.collectionDates,
    publicationDate: group.publicationDate,
    currentStatus: "pending",
    templateStatus: "pending",
  };
}

function notionNoteType(periodicity: AnalysisPeriodicity): string {
  return periodicity === "Mensal" ? "Nota Mensal" : "Não tem no mês";
}

function compareDate(left: string, right: string): number {
  const toTime = (value: string) => {
    const [day, month, year] = value.split("/").map(Number);
    return year && month && day ? Date.UTC(year, month - 1, day) : Number.MAX_SAFE_INTEGER;
  };
  return toTime(left) - toTime(right);
}

function uniqueDates(values: string[]): string[] {
  return [...new Set(values.map(dateOnly).filter(Boolean))].sort((left, right) => {
    const [ld, lm, ly] = left.split("/").map(Number);
    const [rd, rm, ry] = right.split("/").map(Number);
    return Date.UTC(ly, lm - 1, ld) - Date.UTC(ry, rm - 1, rd);
  });
}

function uniqueTextValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function latestUploadId(samples: Array<CollectionSample | StoredAnalysisSample>): string {
  return samples.map((sample) => "lastUploadId" in sample ? sample.lastUploadId : "").filter(Boolean).at(-1) ?? "";
}

function formatCompetence(value: string): string {
  return analysisScheduleMonthLabel(value).replace(" de ", "/");
}
