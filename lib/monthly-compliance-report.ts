import { normalizeText } from "./reconciliation.ts";
import type {
  ComplianceHistoryClient,
  ComplianceHistoryEntry,
  ComplianceItem,
  CompliancePointType,
  MonthlyClientGroup,
  MonthlyExecutiveReportDraft,
  MonthlyLocationGroup,
  MonthlyParameterGroup,
  MonthlyPositionGroup,
} from "./compliance-types";

export interface MonthlyClientAnalyses {
  client: ComplianceHistoryClient;
  entries: ComplianceHistoryEntry[];
}

export function buildMonthlyExecutiveReport(
  monthId: string,
  monthLabel: string,
  clientAnalyses: MonthlyClientAnalyses[],
): MonthlyExecutiveReportDraft {
  const clients: MonthlyClientGroup[] = [];
  const sourceAnalysisIds = new Set<string>();
  const ruleSetVersions = new Set<string>();
  const deduplication = new Set<string>();

  for (const group of clientAnalyses) {
    for (const entry of group.entries) {
      sourceAnalysisIds.add(entry.runId || entry.id);
      if (entry.ruleSetVersion) ruleSetVersions.add(entry.ruleSetVersion);
      for (const item of entry.nonCompliances ?? []) {
        if (item.classification !== "non_compliant") continue;
        addItem(clients, group.client, entry, item, deduplication);
      }
    }
  }

  sortGroups(clients);
  const nonCompliances = clients.reduce(
    (total, client) => total + client.locations.reduce(
      (locationTotal, location) => locationTotal + location.positions.reduce(
        (positionTotal, position) => positionTotal + position.parameters.reduce(
          (parameterTotal, parameter) => parameterTotal + parameter.occurrences.length,
          0,
        ),
        0,
      ),
      0,
    ),
    0,
  );
  const affectedLocations = clients.reduce(
    (total, client) => total + client.locations.length,
    0,
  );
  const report: MonthlyExecutiveReportDraft = {
    monthId,
    monthLabel,
    status: "draft",
    summary: {
      analysesReviewed: sourceAnalysisIds.size,
      affectedClients: clients.length,
      affectedLocations,
      nonCompliances,
    },
    clients,
    text: "",
    sourceAnalysisIds: [...sourceAnalysisIds].sort(),
    ruleSetVersions: [...ruleSetVersions].sort(),
  };
  report.text = monthlyReportText(report);
  return report;
}

export function monthlyReportText(report: MonthlyExecutiveReportDraft): string {
  const lines = [
    "RELATÓRIO MENSAL DE NÃO CONFORMIDADES",
    `Período: ${report.monthLabel}`,
    "",
    `Foram identificados ${report.summary.nonCompliances} resultados fora dos padrões legais, distribuídos em ${report.summary.affectedClients} clientes e ${report.summary.affectedLocations} locais.`,
  ];

  if (!report.clients.length) {
    lines.push("", "Nenhum resultado comprovadamente fora do padrão legal foi identificado no período.");
    return lines.join("\n");
  }

  for (const client of report.clients) {
    lines.push("", "", client.name.toLocaleUpperCase("pt-BR"));
    if (client.cnpj) lines.push(`CNPJ: ${formatCnpj(client.cnpj)}`);
    for (const location of client.locations) {
      lines.push("", location.name.toLocaleUpperCase("pt-BR"));
      for (const position of location.positions) {
        lines.push("", position.name);
        for (const parameter of position.parameters) {
          const count = parameter.occurrences.length;
          lines.push("", `🔴 ${parameter.name}${count > 1 ? ` - ${count} ocorrências` : ""}`);
          for (const occurrence of parameter.occurrences) {
            lines.push(`Resultado: ${occurrence.result}`);
            lines.push(`Limite legal: ${occurrence.ruleDescription}`);
            if (occurrence.sampleNumber) lines.push(`Amostra: ${occurrence.sampleNumber}`);
            if (occurrence.collectionDate) lines.push(`Data da coleta: ${occurrence.collectionDate}`);
            lines.push("Situação: Fora do padrão estabelecido pela legislação.");
            if (occurrence.laboratoryDeclaredNonCompliance) {
              lines.push("Observação: O próprio laudo declara “NÃO ATENDE”.");
            }
            if (count > 1) lines.push("");
          }
        }
      }
    }
  }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function addItem(
  clients: MonthlyClientGroup[],
  clientSource: ComplianceHistoryClient,
  entry: ComplianceHistoryEntry,
  item: ComplianceItem,
  deduplication: Set<string>,
) {
  const clientKey = clientSource.cnpj.replace(/\D/g, "") || clientSource.id;
  const client = findOrAdd(clients, clientKey, () => ({
    key: clientKey,
    name: executiveClientName(clientSource.clientName),
    cnpj: clientSource.cnpj,
    locations: [],
  }));
  const locationInfo = locationFromPoint(item.pointLabel, entry.identity.facilityName);
  const location = findOrAdd(client.locations, locationInfo.key, () => ({
    key: locationInfo.key,
    name: locationInfo.name,
    positions: [],
  }));
  const positionInfo = positionFromItem(item.pointType, locationInfo.position);
  const position = findOrAdd(location.positions, positionInfo.key, () => ({
    key: positionInfo.key,
    name: positionInfo.name,
    order: positionInfo.order,
    parameters: [],
  }));
  const parameter = findOrAdd(position.parameters, item.parameterKey, () => ({
    key: item.parameterKey,
    name: item.parameterName,
    occurrences: [],
  }));
  const occurrenceKey = [
    clientKey,
    location.key,
    position.key,
    item.parameterKey,
    normalizeText(item.sampleNumber),
    normalizeText(item.collectionDate),
    normalizeText(item.resultRaw),
  ].join(":");
  if (deduplication.has(occurrenceKey)) return;
  deduplication.add(occurrenceKey);
  parameter.occurrences.push({
    id: occurrenceKey,
    analysisId: entry.runId || entry.id,
    sampleNumber: item.sampleNumber,
    collectionDate: item.collectionDate,
    result: item.resultRaw,
    unit: item.unit,
    ruleDescription: executiveRuleDescription(item),
    legalReference: item.legalReference,
    laboratoryDeclaredNonCompliance: item.laboratoryConclusion === "does_not_meet",
    sourceFile: item.sourceFile,
  });
}

function executiveRuleDescription(item: ComplianceItem): string {
  if (item.parameterKey === "free_residual_chlorine") {
    return "mínimo de 0,2 mg/L e máximo de 5,0 mg/L";
  }
  return item.ruleDescription.charAt(0).toLocaleLowerCase("pt-BR") + item.ruleDescription.slice(1);
}

function locationFromPoint(pointLabel: string, fallback: string) {
  const parts = pointLabel.split(/\s+-\s+/).filter(Boolean);
  const rawLocation = parts.length > 1 ? parts.at(-1)! : fallback || "Local não identificado";
  const position = parts.length > 1 ? parts.slice(0, -1).join(" - ") : pointLabel;
  const normalized = normalizeText(rawLocation);
  const well = normalized.match(/(?:poco|p)\s*0*(\d+)$/);
  if (well) return { key: `poco:${Number(well[1])}`, name: `Poço ${Number(well[1])}`, position };
  return { key: normalized || "local-nao-identificado", name: titleCase(rawLocation), position };
}

function positionFromItem(pointType: CompliancePointType, raw: string) {
  if (pointType === "source") return { key: "source", name: "Saída do poço", order: 1 };
  if (pointType === "treatment") return { key: "treatment", name: "Saída do tratamento", order: 2 };
  if (pointType === "consumption") return { key: "consumption", name: "Ponto de consumo", order: 3 };
  const normalized = normalizeText(raw) || "outro";
  return { key: normalized, name: sentenceCase(raw || "Outro ponto"), order: 9 };
}

function sortGroups(clients: MonthlyClientGroup[]) {
  clients.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  for (const client of clients) {
    client.locations.sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { numeric: true }));
    for (const location of client.locations) {
      location.positions.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "pt-BR"));
      for (const position of location.positions) {
        position.parameters.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
        for (const parameter of position.parameters) {
          parameter.occurrences.sort((left, right) =>
            left.collectionDate.localeCompare(right.collectionDate, "pt-BR")
            || left.sampleNumber.localeCompare(right.sampleNumber, "pt-BR", { numeric: true }),
          );
        }
      }
    }
  }
}

function executiveClientName(value: string): string {
  return value
    .replace(/\s+-\s+Ouro Fino$/i, "")
    .replace(/\s+LTDA\b.*$/i, "")
    .trim() || value;
}

function titleCase(value: string): string {
  return value.toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s-])([a-záàâãéêíóôõúç])/giu, (_, prefix: string, letter: string) =>
      `${prefix}${letter.toLocaleUpperCase("pt-BR")}`,
    )
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (word) => word.toLocaleLowerCase("pt-BR"));
}

function sentenceCase(value: string): string {
  const lower = value.toLocaleLowerCase("pt-BR");
  return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
}

function findOrAdd<T extends { key: string }>(items: T[], key: string, create: () => T): T {
  const current = items.find((item) => item.key === key);
  if (current) return current;
  const added = create();
  items.push(added);
  return added;
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value;
}

export type MonthlyReportStructure = {
  clients: MonthlyClientGroup[];
  locations: MonthlyLocationGroup[];
  positions: MonthlyPositionGroup[];
  parameters: MonthlyParameterGroup[];
};
