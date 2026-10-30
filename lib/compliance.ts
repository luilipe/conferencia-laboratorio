import { COMPLIANCE_RULE_SET_VERSION, PARAMETER_ALIASES, ruleByKey } from "./compliance-rules.ts";
import { normalizeText } from "./reconciliation.ts";
import type {
  ComplianceClassification,
  ComplianceFileMetadata,
  ComplianceGeneratedReport,
  ComplianceIdentity,
  ComplianceItem,
  CompliancePointSummary,
  CompliancePointType,
  ComplianceResult,
  ComplianceRunDraft,
  ComplianceSummary,
  LegalRule,
  ParsedComplianceBatch,
  ResultOperator,
  SisaguaMonthlySummary,
  SisaguaPointSummary,
} from "./compliance-types";

export interface ComplianceTextPage {
  pageNumber: number;
  text: string;
  lines: string[];
}

export interface ComplianceTextDocument {
  file: ComplianceFileMetadata;
  pages: ComplianceTextPage[];
}

type LabIdentity = {
  clientName: string;
  cnpj: string;
  sampleNumber: string;
  pointLabel: string;
  sampleType: string;
  collectionDate: string;
  facilityName: string;
  pointType: CompliancePointType;
};

const MEASUREMENT_PATTERN =
  /([<>≤≥]=?\s*)?(-?\d+(?:[.,]\d+)?)\s*(µg\s*\/\s*L|ug\s*\/\s*L|mg\s*\/\s*L|NTU|uT|uH|CU|UFC\s*\/\s*mL|Bq\s*\/\s*L)/gi;

const MONTH_NUMBERS: Record<string, string> = {
  janeiro: "01",
  fevereiro: "02",
  marco: "03",
  abril: "04",
  maio: "05",
  junho: "06",
  julho: "07",
  agosto: "08",
  setembro: "09",
  outubro: "10",
  novembro: "11",
  dezembro: "12",
};

export function parseComplianceDocuments(
  documents: ComplianceTextDocument[],
): ParsedComplianceBatch {
  if (!documents.length) throw new Error("Selecione ao menos um arquivo PDF.");

  const labIdentities: LabIdentity[] = [];
  const results: ComplianceResult[] = [];
  const monthlySummaries: SisaguaMonthlySummary[] = [];
  const warnings: string[] = [];
  let sisaguaIdentity: Partial<ComplianceIdentity> = {};

  for (const document of documents) {
    if (document.file.documentType === "laboratory_report") {
      for (const page of document.pages) {
        const parsed = parseLaboratoryPage(page, document.file.name);
        if (!parsed) continue;
        labIdentities.push(parsed.identity);
        results.push(...parsed.results);
      }
      continue;
    }

    if (document.file.documentType === "sisagua_monthly") {
      const parsed = parseSisaguaMonthly(document);
      monthlySummaries.push(parsed.summary);
      sisaguaIdentity = { ...sisaguaIdentity, ...parsed.identity };
      continue;
    }

    warnings.push(`${document.file.name}: formato ainda não homologado.`);
  }

  if (!labIdentities.length && !monthlySummaries.length) {
    throw new Error(
      "Nenhum laudo da MR Ambiental ou relatório mensal de SAC do Sisagua foi reconhecido.",
    );
  }

  const cnpjs = unique(labIdentities.map((entry) => digits(entry.cnpj)).filter(Boolean));
  if (cnpjs.length > 1) {
    throw new Error(
      "O lote contém mais de um CNPJ. Separe os arquivos e analise um cliente por vez.",
    );
  }

  const clientNames = unique(
    labIdentities.map((entry) => normalizeText(entry.clientName)).filter(Boolean),
  );
  if (!cnpjs.length && clientNames.length > 1) {
    throw new Error(
      "O lote contém nomes de clientes diferentes. Separe os arquivos e tente novamente.",
    );
  }

  const firstLab = labIdentities[0];
  const facilityNames = unique(
    labIdentities.map((entry) => entry.facilityName).filter(Boolean),
  );
  const identifiedFacilityName = String(sisaguaIdentity.facilityName || facilityNames[0] || "");
  const facilityName = identifiedFacilityName || "Instalação não identificada";
  const clientName = String(
    firstLab?.clientName ||
      sisaguaIdentity.responsibleInstitution ||
      "Cliente não identificado",
  );

  if (
    firstLab &&
    sisaguaIdentity.responsibleInstitution &&
    !namesAreCompatible(firstLab.clientName, sisaguaIdentity.responsibleInstitution)
  ) {
    throw new Error(
      "O relatório do Sisagua não parece pertencer ao mesmo cliente dos laudos laboratoriais.",
    );
  }

  if (
    firstLab &&
    sisaguaIdentity.facilityName &&
    !labIdentities.some((entry) =>
      normalizeText(entry.pointLabel).includes(normalizeText(sisaguaIdentity.facilityName)),
    )
  ) {
    warnings.push(
      "O nome da SAC do Sisagua não foi encontrado nos pontos dos laudos; revise a identificação.",
    );
  }

  const identity: ComplianceIdentity = {
    clientName,
    cnpj: firstLab?.cnpj ?? "",
    responsibleInstitution: String(sisaguaIdentity.responsibleInstitution || clientName),
    facilityName,
    sisaguaCode: String(sisaguaIdentity.sisaguaCode || ""),
    municipality: String(sisaguaIdentity.municipality || ""),
    state: String(sisaguaIdentity.state || ""),
    sourceType:
      labIdentities.some((entry) => normalizeText(entry.sampleType).includes("subterranea"))
      || documents.some((document) =>
        document.pages.some((page) => normalizeText(page.text).includes("subterraneo")),
      )
        ? "groundwater"
        : "unknown",
    confidence:
      firstLab?.cnpj && (sisaguaIdentity.sisaguaCode || identifiedFacilityName)
        ? "high"
        : firstLab?.clientName
          ? "medium"
          : "low",
  };

  const deduplicated = deduplicateResults(results);
  if (!deduplicated.length) {
    warnings.push("Nenhum parâmetro analítico foi reconhecido nos laudos enviados.");
  }

  return {
    identity,
    results: deduplicated,
    monthlySummaries,
    files: documents.map((document) => document.file),
    warnings,
  };
}

export function buildComplianceRun(batch: ParsedComplianceBatch): ComplianceRunDraft {
  const items = batch.results.map(evaluateResult);
  items.push(...buildNitrateNitriteItems(batch.results));
  items.push(...buildSisaguaConsistencyItems(batch));
  items.push(...buildCoverageItems(batch));

  const summary = summarize(items, batch.files.length);
  return {
    identity: batch.identity,
    ruleSetVersion: COMPLIANCE_RULE_SET_VERSION,
    status: "completed",
    periodLabel: inferPeriodLabel(batch),
    summary,
    files: batch.files,
    warnings: batch.warnings,
    report: buildComplianceReport(batch.identity, items),
    points: buildCompliancePointSummaries(items),
    items,
  };
}

export function buildCompliancePointSummaries(
  items: ComplianceItem[],
): CompliancePointSummary[] {
  const groups = new Map<string, {
    label: string;
    pointType: CompliancePointType;
    samples: Set<string>;
    parameters: Set<string>;
    nonCompliant: number;
    attentionItems: number;
  }>();

  for (const item of items) {
    if (item.sourcePage <= 0 || !item.pointLabel || !item.sampleNumber) continue;
    const key = normalizeText(item.pointLabel) || normalizeText(item.sampleNumber);
    const group = groups.get(key) ?? {
      label: item.pointLabel,
      pointType: item.pointType,
      samples: new Set<string>(),
      parameters: new Set<string>(),
      nonCompliant: 0,
      attentionItems: 0,
    };
    group.samples.add(item.sampleNumber);
    group.parameters.add(`${item.sampleNumber}:${item.parameterKey}`);
    if (item.classification === "non_compliant") group.nonCompliant += 1;
    if (
      item.classification === "inconsistent"
      || item.classification === "coverage_not_proven"
      || item.classification === "no_rule"
    ) {
      group.attentionItems += 1;
    }
    groups.set(key, group);
  }

  const order: Record<CompliancePointType, number> = {
    source: 1,
    treatment: 2,
    consumption: 3,
    unknown: 9,
  };
  return [...groups.entries()]
    .map(([key, group]) => {
      const sampleNumbers = [...group.samples].sort((left, right) =>
        left.localeCompare(right, "pt-BR", { numeric: true }),
      );
      return {
        key,
        label: group.label,
        pointType: group.pointType,
        sampleNumbers,
        samples: sampleNumbers.length,
        parameters: group.parameters.size,
        nonCompliant: group.nonCompliant,
        attentionItems: group.attentionItems,
        status: group.nonCompliant > 0
          ? "non_compliant" as const
          : group.attentionItems > 0
            ? "attention" as const
            : "compliant" as const,
      };
    })
    .sort((left, right) =>
      order[left.pointType] - order[right.pointType]
      || left.label.localeCompare(right.label, "pt-BR", { numeric: true }),
    );
}

export function buildComplianceReport(
  identity: ComplianceIdentity,
  items: ComplianceItem[],
): ComplianceGeneratedReport | null {
  const nonCompliant = items.filter((item) => item.classification === "non_compliant");
  if (!nonCompliant.length) return null;

  const sections: ComplianceGeneratedReport["sections"] = nonCompliant.map((item) => {
    const standard = reportStandard(item);
    const parameterName = displayName(item.parameterName);
    const situation = item.parameterKey === "free_residual_chlorine"
      ? `NÃO ATENDE — o resultado encontra-se abaixo do padrão mínimo estabelecido para o parâmetro ${parameterName}.`
      : `NÃO ATENDE — o resultado encontra-se fora do padrão estabelecido para o parâmetro ${parameterName}.`;
    return {
      id: item.id,
      marker: "red" as const,
      heading: reportLocationHeading(item.pointLabel, identity.facilityName),
      parameterKey: item.parameterKey,
      pointLabel: reportPointLabel(item.pointLabel),
      parameterName,
      result: item.resultRaw,
      standardLabel: standard.label,
      standardValue: standard.value,
      situation,
      classification: item.classification,
      sampleNumber: item.sampleNumber,
      sourceFile: item.sourceFile,
    };
  });

  const marker = { red: "🔴", amber: "🟠", green: "🟢" } as const;
  const text = sections
    .map((section) => [
      `${marker[section.marker]} Ponto de coleta: ${section.pointLabel}`,
      section.parameterName,
      `Resultado: ${section.result}`,
      `${section.standardLabel}: ${section.standardValue}`,
      `Situação: ${section.situation}`,
    ].join("\n"))
    .join("\n\n");

  return {
    title: `Relatório de conformidade – ${identity.clientName} – ${identity.facilityName}`,
    sections,
    text,
  };
}

export function complianceMonthKey(periodLabel: string): string {
  const normalized = normalizeText(periodLabel);
  const namedMonth = Object.entries(MONTH_NUMBERS)
    .find(([name]) => normalized.includes(name));
  const year = periodLabel.match(/\b(20\d{2})\b/)?.[1];
  if (namedMonth && year) return `${year}-${namedMonth[1]}`;
  const numeric = periodLabel.match(/\b(0?[1-9]|1[0-2])[/-](20\d{2})\b/);
  if (numeric) return `${numeric[2]}-${numeric[1].padStart(2, "0")}`;
  return "periodo-nao-identificado";
}

function parseLaboratoryPage(
  page: ComplianceTextPage,
  sourceFile: string,
): { identity: LabIdentity; results: ComplianceResult[] } | null {
  const normalized = normalizeText(page.text);
  if (!normalized.includes("relatorio de analises") || !normalized.includes("resultados analiticos")) {
    return null;
  }

  const clientMatch = page.text.match(
    /Cliente:\s*(.+?)\s+CNPJ\/CPF:\s*([\d./-]+)/i,
  );
  const sampleMatch = page.text.match(
    /N[º°o]?\s*Amostra:\s*([0-9]+-\d+\/\d{4}\.\d+)\s*-\s*([^\n]+)/i,
  );
  if (!sampleMatch) return null;

  const pointLabel = clean(sampleMatch[2]);
  const sampleType = fieldValue(page.text, "Tipo de Amostra");
  const collectionDate =
    page.text.match(/Data Coleta:\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2})?)/i)?.[1]
    ?? "";
  const identity: LabIdentity = {
    clientName: clean(clientMatch?.[1] ?? ""),
    cnpj: clean(clientMatch?.[2] ?? ""),
    sampleNumber: clean(sampleMatch[1]),
    pointLabel,
    sampleType,
    collectionDate,
    facilityName: facilityFromPoint(pointLabel),
    pointType: classifyPoint(pointLabel),
  };
  const conclusion = extractLaboratoryConclusion(page.lines);

  const results: ComplianceResult[] = [];
  const recognized = new Set<string>();
  for (const alias of PARAMETER_ALIASES) {
    if (recognized.has(alias.parameterKey)) continue;
    const found = extractParameterResult(page.lines, alias.normalizedAlias, alias.qualitative);
    if (!found) continue;
    recognized.add(alias.parameterKey);
    results.push({
      id: resultId(identity.sampleNumber, alias.parameterKey, sourceFile, page.pageNumber),
      sampleNumber: identity.sampleNumber,
      sampleType,
      pointLabel,
      pointType: identity.pointType,
      collectionDate,
      parameterKey: alias.parameterKey,
      parameterName: alias.parameterName,
      resultRaw: found.raw,
      operator: found.operator,
      value: found.value,
      unit: found.unit,
      lq: "",
      ld: "",
      sourceFile,
      sourcePage: page.pageNumber,
      laboratoryConclusion:
        conclusion.status === "does_not_meet"
        && conclusion.parameterText
        && !normalizeText(conclusion.parameterText).includes(normalizeText(alias.parameterName))
          ? "not_declared"
          : conclusion.status,
      laboratoryConclusionRaw: conclusion.raw,
    });
  }

  return { identity, results };
}

function extractParameterResult(
  lines: string[],
  normalizedAlias: string,
  qualitative: boolean,
): { raw: string; operator: ResultOperator; value: number | null; unit: string } | null {
  const indexes = lines
    .map((line, index) => ({ index, normalized: normalizeText(line) }))
    .filter((entry) => entry.normalized.includes(normalizedAlias))
    .map((entry) => entry.index);

  for (const index of indexes) {
    const window = lines.slice(index, index + 4).join(" ");
    if (qualitative) {
      const qualitativeMatch = window.match(/\b(Ausência|Presença)\s+em\s+100\s*mL\b/i);
      if (qualitativeMatch) {
        return {
          raw: clean(qualitativeMatch[0]),
          operator: "qualitative",
          value: null,
          unit: "100 mL",
        };
      }
      continue;
    }

    if (normalizedAlias === "ph" || normalizedAlias.includes("potencial hidrogenionico")) {
      const phMatch = window.match(/\bpH\s*([<>≤≥]=?\s*)?(-?\d+(?:[.,]\d+)?)/i);
      if (phMatch) {
        const operator = parseOperator(phMatch[1] ?? "");
        return {
          raw: `${operator === "=" ? "" : operator} ${phMatch[2]}`.trim(),
          operator,
          value: parseDecimal(phMatch[2]),
          unit: "",
        };
      }
    }

    MEASUREMENT_PATTERN.lastIndex = 0;
    const measurement = MEASUREMENT_PATTERN.exec(window);
    if (!measurement) continue;
    const operator = parseOperator(measurement[1] ?? "");
    const unit = normalizeUnit(measurement[3]);
    return {
      raw: clean(measurement[0]),
      operator,
      value: parseDecimal(measurement[2]),
      unit,
    };
  }
  return null;
}

function parseSisaguaMonthly(document: ComplianceTextDocument): {
  identity: Partial<ComplianceIdentity>;
  summary: SisaguaMonthlySummary;
} {
  const text = document.pages.map((page) => page.text).join("\n");
  const lines = document.pages.flatMap((page) => page.lines);
  const month = fieldValue(text, "Mês");
  const year = text.match(/\b\d{2}\/\d{2}\/(\d{4})\b/)?.[1] ?? "";
  const chlorineIndex = lines.findIndex((line) =>
    normalizeText(line) === "cloro residual livre",
  );
  const chlorineLines = chlorineIndex >= 0 ? lines.slice(chlorineIndex, chlorineIndex + 20) : [];

  const samples = pairFromMetric(chlorineLines, "numero de amostras analisadas");
  const p95 = pairFromMetric(chlorineLines, "percentil 95");
  const above = pairFromMetric(chlorineLines, "numero de dados > 5 0 mg l");
  const inRange = pairFromMetric(chlorineLines, "numero de dados >= 0 2 mg l e <= 5 0mg l")
    ?? pairFromMetric(chlorineLines, "numero de dados >= 0 2 mg l e <= 5 0 mg l");
  const below = pairFromMetric(chlorineLines, "numero de dados < 0 2 mg l");

  const points: SisaguaPointSummary[] = ["treatment", "consumption"].map(
    (pointType, index) => ({
      pointType: pointType as "treatment" | "consumption",
      samplesAnalyzed: samples?.[index] ?? null,
      percentile95: p95?.[index] ?? null,
      aboveMaximum: above?.[index] ?? null,
      inRange: inRange?.[index] ?? null,
      belowMinimum: below?.[index] ?? null,
    }),
  );

  return {
    identity: {
      responsibleInstitution: fieldValue(text, "Instituição Responsável"),
      facilityName: fieldValue(text, "Nome SAC"),
      sisaguaCode: fieldValue(text, "Código SAC"),
      municipality: fieldValue(text, "Município"),
      state: fieldValue(text, "UF"),
    },
    summary: {
      month,
      year,
      freeChlorine: points,
      sourceFile: document.file.name,
    },
  };
}

function pairFromMetric(lines: string[], metric: string): [number, number] | null {
  const target = normalizeText(metric);
  // A linha "< 0,2" também é prefixo normalizado da faixa "0,2 a 5,0".
  // No relatório oficial a faixa vem antes do limite inferior; usar a última
  // ocorrência impede que a contagem da faixa seja lida como abaixo do mínimo.
  const line = lines.findLast((candidate) => normalizeText(candidate).startsWith(target));
  if (!line) return null;
  const values = [...line.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((match) =>
    parseDecimal(match[0]),
  );
  if (values.length < 2) return null;
  return [values.at(-2)!, values.at(-1)!];
}

function evaluateResult(result: ComplianceResult): ComplianceItem {
  const rule = ruleByKey(result.parameterKey);
  if (!rule) return itemFromResult(result, "no_rule", null, "Parâmetro sem regra publicada.");

  if (!rule.appliesTo.includes(result.pointType)) {
    return itemFromResult(
      result,
      "informational",
      rule,
      `O resultado foi lido, mas a regra de potabilidade não é aplicada automaticamente ao ponto “${result.pointLabel}”.`,
    );
  }

  if (rule.operator === "informational") {
    return itemFromResult(result, "informational", rule, rule.note);
  }

  if (rule.operator === "absence") {
    const normalized = normalizeText(result.resultRaw);
    const absent = normalized.includes("ausencia");
    if (
      result.parameterKey === "total_coliforms"
      && result.pointType === "consumption"
      && !absent
    ) {
      return itemFromResult(
        result,
        "coverage_not_proven",
        rule,
        "A conclusão no ponto de consumo depende do conjunto mensal e da população abastecida.",
      );
    }
    return itemFromResult(
      result,
      absent ? "compliant" : "non_compliant",
      rule,
      absent ? "Resultado qualitativo atende à exigência de ausência." : "Foi detectada presença no volume analisado.",
    );
  }

  if (result.value == null) {
    return itemFromResult(result, "no_rule", rule, "O resultado não pôde ser convertido em valor numérico.");
  }

  const value = convertUnit(result.value, result.unit, rule.unit);
  if (value == null) {
    return itemFromResult(
      result,
      "no_rule",
      rule,
      `A unidade ${result.unit || "não informada"} não pôde ser convertida para ${rule.unit}.`,
    );
  }

  const classification = compareResult(value, result.operator, rule);
  const note =
    classification === "compliant"
      ? "O resultado está dentro do limite aplicável."
      : classification === "non_compliant"
        ? "O resultado está comprovadamente fora do limite aplicável."
        : "O qualificador do resultado não permite uma conclusão numérica segura.";
  return itemFromResult(result, classification, rule, note);
}

function compareResult(
  value: number,
  operator: ResultOperator,
  rule: LegalRule,
): ComplianceClassification {
  const min = rule.minimum;
  const max = rule.maximum;
  let uncertain = false;

  if (min != null) {
    if (operator === "=" && value < min) return "non_compliant";
    if (operator === "<" && value <= min) return "non_compliant";
    if (operator === "<=" && value < min) return "non_compliant";
    if (
      (operator === "<" && value > min)
      || (operator === "<=" && value >= min)
      || ((operator === ">" || operator === ">=") && value < min)
    ) uncertain = true;
  }

  if (max != null) {
    if (operator === "=" && value > max) return "non_compliant";
    if (operator === ">" && value >= max) return "non_compliant";
    if (operator === ">=" && value > max) return "non_compliant";
    if (
      (operator === ">" && value < max)
      || (operator === ">=" && value <= max)
      || ((operator === "<" || operator === "<=") && value > max)
    ) uncertain = true;
  }

  return uncertain ? "no_rule" : "compliant";
}

function itemFromResult(
  result: ComplianceResult,
  classification: ComplianceClassification,
  rule: LegalRule | null,
  note: string,
): ComplianceItem {
  return {
    ...result,
    classification,
    ruleId: rule?.id ?? null,
    ruleDescription: rule ? describeRule(rule) : "Sem regra publicada",
    legalReference: rule?.legalReference ?? "",
    legalSourceUrl: rule?.legalSourceUrl ?? "",
    frequency: rule?.frequency ?? "not_defined",
    note,
  };
}

function buildNitrateNitriteItems(results: ComplianceResult[]): ComplianceItem[] {
  const bySample = new Map<string, ComplianceResult[]>();
  for (const result of results) {
    if (!bySample.has(result.sampleNumber)) bySample.set(result.sampleNumber, []);
    bySample.get(result.sampleNumber)!.push(result);
  }

  const items: ComplianceItem[] = [];
  for (const [sampleNumber, sampleResults] of bySample) {
    const nitrate = sampleResults.find((item) => item.parameterKey === "nitrate");
    const nitrite = sampleResults.find((item) => item.parameterKey === "nitrite");
    if (nitrate?.value == null || nitrite?.value == null) continue;
    const nitrateValue = convertUnit(nitrate.value, nitrate.unit, "mg/L");
    const nitriteValue = convertUnit(nitrite.value, nitrite.unit, "mg/L");
    if (nitrateValue == null || nitriteValue == null) continue;
    const ratio = nitrateValue / 10 + nitriteValue / 1;
    items.push({
      ...nitrate,
      id: `${sampleNumber}-nitrate-nitrite-sum`,
      parameterKey: "nitrate_nitrite_sum",
      parameterName: "Soma normalizada de nitrato e nitrito",
      resultRaw: ratio.toLocaleString("pt-BR", { maximumFractionDigits: 4 }),
      operator: "=",
      value: ratio,
      unit: "razão",
      classification: ratio <= 1 ? "compliant" : "non_compliant",
      ruleId: `${COMPLIANCE_RULE_SET_VERSION}:nitrate_nitrite_sum`,
      ruleDescription: "(Nitrato/10) + (Nitrito/1) ≤ 1",
      legalReference: "Art. 39 do Anexo XX da PRC GM/MS nº 5/2017",
      legalSourceUrl: ruleByKey("nitrate")?.legalSourceUrl ?? "",
      frequency: "semiannual",
      note: ratio <= 1 ? "A soma normalizada atende ao limite." : "A soma normalizada ultrapassa 1.",
    });
  }
  return items;
}

function buildSisaguaConsistencyItems(batch: ParsedComplianceBatch): ComplianceItem[] {
  const items: ComplianceItem[] = [];
  for (const summary of batch.monthlySummaries) {
    for (const point of summary.freeChlorine) {
      const lowLabResults = batch.results.filter(
        (result) =>
          result.parameterKey === "free_residual_chlorine"
          && result.pointType === point.pointType
          && result.value != null
          && result.operator === "<"
          && result.value <= 0.2,
      );
      if (!lowLabResults.length) continue;
      if ((point.belowMinimum ?? 0) > 0 || (point.inRange ?? 0) === 0) continue;

      const pointLabel = point.pointType === "treatment" ? "Saída do tratamento" : "Ponto de consumo";
      items.push(syntheticItem({
        id: `sisagua-chlorine-${point.pointType}-${summary.month}-${summary.year}`,
        classification: "inconsistent",
        pointLabel,
        pointType: point.pointType,
        parameterKey: "sisagua_free_chlorine_band",
        parameterName: "Faixa declarada do cloro no Sisagua",
        resultRaw: `${point.inRange ?? 0} na faixa e ${point.belowMinimum ?? 0} abaixo do mínimo`,
        sourceFile: summary.sourceFile,
        note:
          `Os laudos apresentam ${lowLabResults.map((entry) => entry.resultRaw).join(" e ")}, mas o relatório mensal não contabiliza resultado abaixo de 0,2 mg/L.`,
        ruleDescription: "Coerência entre laudos e faixas declaradas no controle mensal",
        legalReference: "Regras de negócio do Controle Mensal de SAC - Sisagua",
      }));
    }
  }
  return items;
}

function buildCoverageItems(batch: ParsedComplianceBatch): ComplianceItem[] {
  const items: ComplianceItem[] = [];
  for (const summary of batch.monthlySummaries) {
    for (const point of summary.freeChlorine) {
      if (point.samplesAnalyzed == null || point.samplesAnalyzed > 1) continue;
      const pointLabel = point.pointType === "treatment" ? "Saída do tratamento" : "Ponto de consumo";
      items.push(syntheticItem({
        id: `coverage-chlorine-${point.pointType}-${summary.month}-${summary.year}`,
        classification: "coverage_not_proven",
        pointLabel,
        pointType: point.pointType,
        parameterKey: "free_residual_chlorine_coverage",
        parameterName: "Cobertura do monitoramento de cloro",
        resultRaw: `${point.samplesAnalyzed} amostra informada no relatório mensal`,
        sourceFile: summary.sourceFile,
        note:
          "O Anexo 15 prevê frequência diária. Os documentos enviados não comprovam todo o acompanhamento diário; registros operacionais podem existir fora deste lote.",
        ruleDescription: "Monitoramento diário na saída do tratamento e no ponto de consumo",
        legalReference: "Anexo 15 do Anexo XX da PRC GM/MS nº 5/2017",
        frequency: "daily",
      }));
    }
  }
  return items;
}

function syntheticItem(options: {
  id: string;
  classification: ComplianceClassification;
  pointLabel: string;
  pointType: CompliancePointType;
  parameterKey: string;
  parameterName: string;
  resultRaw: string;
  sourceFile: string;
  note: string;
  ruleDescription: string;
  legalReference: string;
  frequency?: ComplianceItem["frequency"];
}): ComplianceItem {
  return {
    id: options.id,
    sampleNumber: "Controle mensal",
    sampleType: "Água tratada",
    pointLabel: options.pointLabel,
    pointType: options.pointType,
    collectionDate: "",
    parameterKey: options.parameterKey,
    parameterName: options.parameterName,
    resultRaw: options.resultRaw,
    operator: "qualitative",
    value: null,
    unit: "",
    lq: "",
    ld: "",
    sourceFile: options.sourceFile,
    sourcePage: 0,
    laboratoryConclusion: "not_declared",
    laboratoryConclusionRaw: "",
    classification: options.classification,
    ruleId: null,
    ruleDescription: options.ruleDescription,
    legalReference: options.legalReference,
    legalSourceUrl: ruleByKey("free_residual_chlorine")?.legalSourceUrl ?? "",
    frequency: options.frequency ?? "monthly",
    note: options.note,
  };
}

function summarize(items: ComplianceItem[], fileCount: number): ComplianceSummary {
  const count = (classification: ComplianceClassification) =>
    items.filter((item) => item.classification === classification).length;
  const samples = unique(
    items
      .map((item) => item.sampleNumber)
      .filter((sample) => sample && sample !== "Controle mensal"),
  ).length;
  const nonCompliant = count("non_compliant");
  const inconsistent = count("inconsistent");
  const coverageNotProven = count("coverage_not_proven");
  const withoutRule = count("no_rule");
  return {
    files: fileCount,
    samples,
    parameters: unique(
      items
        .filter((item) => item.sampleNumber !== "Controle mensal")
        .map((item) => `${item.sampleNumber}:${item.parameterKey}`),
    ).length,
    compliant: count("compliant"),
    nonCompliant,
    inconsistent,
    coverageNotProven,
    withoutRule,
    informational: count("informational"),
    attentionItems: nonCompliant + inconsistent + coverageNotProven + withoutRule,
  };
}

function deduplicateResults(results: ComplianceResult[]): ComplianceResult[] {
  const byKey = new Map<string, ComplianceResult>();
  for (const result of results) {
    const key = [
      normalizeText(result.sampleNumber),
      result.parameterKey,
      normalizeText(result.resultRaw),
    ].join(":");
    if (!byKey.has(key)) byKey.set(key, result);
  }
  return [...byKey.values()].sort((left, right) =>
    left.sampleNumber.localeCompare(right.sampleNumber, "pt-BR", { numeric: true })
    || left.sourcePage - right.sourcePage
    || left.parameterName.localeCompare(right.parameterName, "pt-BR"),
  );
}

function describeRule(rule: LegalRule): string {
  const unit = rule.unit ? ` ${rule.unit}` : "";
  if (rule.operator === "max") return `Máximo ${formatNumber(rule.maximum!)}${unit}`;
  if (rule.operator === "min") return `Mínimo ${formatNumber(rule.minimum!)}${unit}`;
  if (rule.operator === "range") {
    return `Entre ${formatNumber(rule.minimum!)} e ${formatNumber(rule.maximum!)}${unit}`;
  }
  if (rule.operator === "absence") return `Ausência em ${rule.unit}`;
  return "Monitoramento informativo";
}

function classifyPoint(pointLabel: string): CompliancePointType {
  const normalized = normalizeText(pointLabel);
  if (normalized.includes("ponto de consumo") || normalized.includes("ponto consumo")) {
    return "consumption";
  }
  if (normalized.includes("saida do tratamento") || normalized.includes("saida tratamento")) {
    return "treatment";
  }
  if (
    normalized.includes("saida do poco")
    || normalized.includes("captacao")
    || normalized.includes("agua bruta")
  ) {
    return "source";
  }
  return "unknown";
}

function facilityFromPoint(pointLabel: string): string {
  const parts = pointLabel.split(/\s+-\s+/).filter(Boolean);
  return parts.length > 1 ? clean(parts.at(-1)) : "";
}

function fieldValue(text: string, label: string): string {
  const normalizedLabel = normalizeText(label);
  for (const line of text.split(/\r?\n/)) {
    const normalizedLine = normalizeText(line);
    if (!normalizedLine.startsWith(normalizedLabel)) continue;
    return clean(line.replace(/^[^:]+:\s*/, ""));
  }
  return "";
}

function namesAreCompatible(left: string, right: string): boolean {
  const ignored = new Set(["ltda", "sa", "s", "a", "ouro", "fino"]);
  const leftTokens = new Set(normalizeText(left).split(" ").filter((token) => token && !ignored.has(token)));
  const rightTokens = new Set(normalizeText(right).split(" ").filter((token) => token && !ignored.has(token)));
  if (!leftTokens.size || !rightTokens.size) return true;
  let common = 0;
  for (const token of rightTokens) if (leftTokens.has(token)) common += 1;
  return common / Math.min(leftTokens.size, rightTokens.size) >= 0.6;
}

function convertUnit(value: number, from: string, to: string): number | null {
  const source = normalizeUnit(from).toLowerCase();
  const target = normalizeUnit(to).toLowerCase();
  if (!target || source === target) return value;
  if ((source === "ntu" && target === "ut") || (source === "ut" && target === "ntu")) {
    return value;
  }
  if ((source === "cu" && target === "uh") || (source === "uh" && target === "cu")) {
    return value;
  }
  if (source === "µg/l" && target === "mg/l") return value / 1000;
  if (source === "mg/l" && target === "µg/l") return value * 1000;
  return null;
}

function normalizeUnit(value: string): string {
  return clean(value)
    .replace(/ug/gi, "µg")
    .replace(/\s*\/\s*/g, "/")
    .replace(/^NTU$/i, "NTU")
    .replace(/^UT$/i, "uT")
    .replace(/^UH$/i, "uH")
    .replace(/^CU$/i, "CU")
    .replace(/^UFC\/ML$/i, "UFC/mL")
    .replace(/^BQ\/L$/i, "Bq/L");
}

function parseOperator(value: string): ResultOperator {
  const normalized = value.replace(/\s+/g, "").replace("≤", "<=").replace("≥", ">=");
  if (normalized === "<" || normalized === "<=" || normalized === ">" || normalized === ">=") {
    return normalized;
  }
  return "=";
}

function parseDecimal(value: string): number {
  const trimmed = value.trim();
  if (trimmed.includes(",") && trimmed.includes(".")) {
    return Number(trimmed.replace(/\./g, "").replace(",", "."));
  }
  return Number(trimmed.replace(",", "."));
}

function inferPeriodLabel(batch: ParsedComplianceBatch): string {
  const sampleCompetences = new Set<string>();
  const seenSamples = new Set<string>();

  for (const result of batch.results) {
    const sampleKey = normalizeText(result.sampleNumber) || result.id;
    if (seenSamples.has(sampleKey)) continue;
    const match = result.collectionDate.match(/\b\d{2}\/(0[1-9]|1[0-2])\/(20\d{2})\b/);
    if (match) {
      seenSamples.add(sampleKey);
      sampleCompetences.add(`${match[2]}-${match[1]}`);
    }
  }

  if (sampleCompetences.size > 1) {
    throw new Error(
      "As amostras possuem datas de coleta em meses diferentes. Separe os laudos por mês e analise novamente.",
    );
  }

  const competence = [...sampleCompetences][0];
  if (!competence) return "Período não identificado";
  const [year, month] = competence.split("-");
  return `${month}/${year}`;
}

function resultId(sample: string, parameter: string, file: string, page: number): string {
  const safe = normalizeText(`${sample}-${parameter}-${file}-${page}`)
    .replace(/\s+/g, "-")
    .slice(0, 140);
  return safe || `${parameter}-${page}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}

function extractLaboratoryConclusion(lines: string[]): {
  status: ComplianceResult["laboratoryConclusion"];
  raw: string;
  parameterText: string;
} {
  const index = lines.findIndex((line) =>
    normalizeText(line).includes("a presente amostra em relacao aos parametros analisados"),
  );
  if (index < 0) return { status: "not_declared", raw: "", parameterText: "" };
  const raw = clean(lines.slice(index, index + 4).join(" "));
  const normalized = normalizeText(raw);
  const status = normalized.includes("nao atende")
    ? "does_not_meet"
    : normalized.includes("atende aos padroes")
      ? "meets"
      : "not_declared";
  const parameterText = clean(
    raw.match(/par[aâ]metro\(s\)\s+(.+?)(?:\.|$)/i)?.[1] ?? "",
  );
  return { status, raw, parameterText };
}

function displayName(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s-])([a-záàâãéêíóôõúç])/giu, (_, prefix: string, letter: string) =>
      `${prefix}${letter.toLocaleUpperCase("pt-BR")}`,
    )
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (word) => word.toLocaleLowerCase("pt-BR"));
}

function reportLocationHeading(pointLabel: string, fallbackFacility: string): string {
  const parts = pointLabel.split(/\s+-\s+/);
  const facility = parts.length > 1 ? parts.at(-1)! : fallbackFacility;
  const point = parts.length > 1 ? parts.slice(0, -1).join(" – ") : pointLabel;
  const displayed = point.toLocaleLowerCase("pt-BR");
  const displayedPoint = displayed.charAt(0).toLocaleUpperCase("pt-BR") + displayed.slice(1);
  return `${displayName(facility)} – ${displayedPoint}`;
}

function reportPointLabel(pointLabel: string): string {
  const parts = pointLabel.split(/\s+-\s+/);
  return parts.length > 1
    ? reportLocationHeading(pointLabel, "")
    : displayName(pointLabel);
}

function reportStandard(item: ComplianceItem): { label: string; value: string } {
  const { ruleDescription } = item;
  const minimum = ruleDescription.match(/^Mínimo\s+(.+)$/i);
  if (minimum) return { label: "Padrão mínimo", value: minimum[1] };

  const maximum = ruleDescription.match(/^Máximo\s+(.+)$/i);
  if (maximum) return { label: "Padrão máximo", value: maximum[1] };

  const range = ruleDescription.match(/^Entre\s+([\d,.]+)\s+e\s+([\d,.]+)(.*)$/i);
  if (range) {
    const lower = Number(range[1].replace(",", "."));
    const upper = Number(range[2].replace(",", "."));
    const unit = range[3];
    if (item.value !== null && item.value < lower) {
      return { label: "Padrão mínimo", value: `${range[1]}${unit}` };
    }
    if (item.value !== null && item.value > upper) {
      return { label: "Padrão máximo", value: `${range[2]}${unit}` };
    }
    return { label: "Faixa permitida", value: `${range[1]} a ${range[2]}${unit}` };
  }

  const absence = ruleDescription.match(/^Ausência\s+(.+)$/i);
  if (absence) return { label: "Padrão", value: `Ausência ${absence[1]}` };

  return { label: "Padrão legal", value: ruleDescription };
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
