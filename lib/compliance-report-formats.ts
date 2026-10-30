import type {
  ComplianceGeneratedReport,
  ComplianceIdentity,
  IndividualReportOrientationMap,
  MonthlyExecutiveReport,
} from "./compliance-types";

export interface IndividualComplianceReportContext {
  identity: ComplianceIdentity;
  periodLabel: string;
  report: ComplianceGeneratedReport;
  orientationBySectionId?: IndividualReportOrientationMap;
}

const SECTION_MARKERS = {
  red: "🔴",
  amber: "🟠",
  green: "🟢",
} as const;

export function formatIndividualWhatsAppReport(
  context: IndividualComplianceReportContext,
): string {
  const lines = [
    "*RELATÓRIO DE NÃO CONFORMIDADE*",
    "",
    `*Cliente:* ${context.identity.clientName}`,
    `*Período:* ${context.periodLabel}`,
  ];

  for (const section of context.report.sections) {
    const hasDetailedIdentification = Boolean(section.pointLabel && section.parameterName);
    const orientation = context.orientationBySectionId?.[section.id]?.trim() ?? "";
    lines.push(
      "",
      hasDetailedIdentification
        ? `${SECTION_MARKERS[section.marker]} *Ponto de coleta:* ${section.pointLabel}`
        : `${SECTION_MARKERS[section.marker]} *${section.heading}*`,
      ...(section.parameterName ? [section.parameterName] : []),
      `*Resultado:* ${section.result}`,
      ...(section.standardLabel && section.standardValue
        ? [`*${section.standardLabel}:* ${section.standardValue}`]
        : []),
      `*Situação:* ${section.situation}`,
      ...(orientation ? [`*Orientação:* ${orientation}`] : []),
    );
  }

  return lines.join("\n").trim();
}

export function formatIndividualEmailReport(
  context: IndividualComplianceReportContext,
): string {
  const lines = [
    "Prezados,",
    "",
    "Segue o resultado da análise de conformidade.",
    "",
    `Cliente: ${context.identity.clientName}`,
  ];
  if (context.identity.cnpj) lines.push(`CNPJ: ${formatCnpj(context.identity.cnpj)}`);
  lines.push(`Período: ${context.periodLabel}`);

  for (const section of context.report.sections) {
    const hasDetailedIdentification = Boolean(section.pointLabel && section.parameterName);
    const orientation = context.orientationBySectionId?.[section.id]?.trim() ?? "";
    lines.push(
      "",
      hasDetailedIdentification
        ? `${SECTION_MARKERS[section.marker]} Ponto de coleta: ${section.pointLabel}`
        : `${SECTION_MARKERS[section.marker]} ${section.heading}`,
      ...(section.parameterName ? [section.parameterName] : []),
      `Resultado: ${section.result}`,
      ...(section.standardLabel && section.standardValue
        ? [`${section.standardLabel}: ${section.standardValue}`]
        : []),
      `Situação: ${section.situation}`,
      ...(orientation ? [`Orientação: ${orientation}`] : []),
    );
  }

  if (context.report.sections.some((section) => section.marker === "red")) {
    lines.push("", "Este relatório apresenta somente resultados comprovadamente fora do padrão.");
  }
  return lines.join("\n").trim();
}

export function formatMonthlyWhatsAppReport(report: MonthlyExecutiveReport): string {
  const lines = [
    "*RELATÓRIO MENSAL DE NÃO CONFORMIDADES*",
    "",
    `*Período:* ${report.monthLabel}`,
    `*Resumo:* ${monthlySummary(report)}`,
  ];

  appendMonthlyDetails(lines, report, "whatsapp");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatMonthlyEmailReport(report: MonthlyExecutiveReport): string {
  const lines = [
    `Assunto: Relatório mensal de não conformidades – ${report.monthLabel}`,
    "",
    "Prezados,",
    "",
    `Segue o relatório mensal de não conformidades referente a ${report.monthLabel}.`,
    "",
    monthlySummary(report),
  ];

  appendMonthlyDetails(lines, report, "email");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function appendMonthlyDetails(
  lines: string[],
  report: MonthlyExecutiveReport,
  channel: "whatsapp" | "email",
) {
  if (!report.clients.length) {
    lines.push("", "Nenhum resultado comprovadamente fora do padrão legal foi identificado no período.");
    return;
  }

  for (const client of report.clients) {
    lines.push("", channel === "whatsapp" ? `*${client.name.toLocaleUpperCase("pt-BR")}*` : client.name.toLocaleUpperCase("pt-BR"));
    if (channel === "email" && client.cnpj) lines.push(`CNPJ: ${formatCnpj(client.cnpj)}`);
    for (const location of client.locations) {
      lines.push("", channel === "whatsapp" ? `*${location.name.toLocaleUpperCase("pt-BR")}*` : location.name.toLocaleUpperCase("pt-BR"));
      for (const position of location.positions) {
        lines.push("", channel === "whatsapp" ? `*${position.name}*` : position.name);
        for (const parameter of position.parameters) {
          const count = parameter.occurrences.length;
          lines.push(
            "",
            `🔴 ${channel === "whatsapp" ? `*${parameter.name}*` : parameter.name}${count > 1 ? ` – ${count} ocorrências` : ""}`,
          );
          for (const occurrence of parameter.occurrences) {
            const label = (value: string) => channel === "whatsapp" ? `*${value}:*` : `${value}:`;
            lines.push(`${label("Resultado")} ${occurrence.result}`);
            lines.push(`${label("Limite legal")} ${occurrence.ruleDescription}`);
            if (occurrence.sampleNumber) lines.push(`${label("Amostra")} ${occurrence.sampleNumber}`);
            if (occurrence.collectionDate) lines.push(`${label("Data da coleta")} ${occurrence.collectionDate}`);
            lines.push(`${label("Situação")} Fora do padrão estabelecido pela legislação.`);
            if (occurrence.laboratoryDeclaredNonCompliance) {
              lines.push(`${label("Observação")} O próprio laudo declara “NÃO ATENDE”.`);
            }
            if (count > 1) lines.push("");
          }
        }
      }
    }
  }
}

function monthlySummary(report: MonthlyExecutiveReport): string {
  const { nonCompliances, affectedClients, affectedLocations } = report.summary;
  return `Foram identificados ${nonCompliances} ${plural(nonCompliances, "resultado", "resultados")} fora dos padrões legais, distribuídos em ${affectedClients} ${plural(affectedClients, "cliente", "clientes")} e ${affectedLocations} ${plural(affectedLocations, "local", "locais")}.`;
}

function plural(value: number, singular: string, pluralForm: string) {
  return value === 1 ? singular : pluralForm;
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value;
}
