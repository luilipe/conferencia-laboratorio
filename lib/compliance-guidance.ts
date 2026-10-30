import type {
  ComplianceGeneratedReport,
  ComplianceGuidance,
  IndividualReportOrientation,
  IndividualReportOrientationMap,
  IndividualReportSettings,
} from "./compliance-types";

export const COMPLIANCE_GUIDANCE_MAX_LENGTH = 500;

export function normalizeGuidanceText(value: string): string {
  return value.trim().slice(0, COMPLIANCE_GUIDANCE_MAX_LENGTH);
}

export function resolveIndividualReportOrientations(
  report: ComplianceGeneratedReport | null,
  catalog: ComplianceGuidance[],
  settings: IndividualReportSettings | null = null,
): IndividualReportOrientationMap {
  if (!report) return {};

  const defaults = new Map(
    catalog
      .filter((entry) => entry.active && entry.text.trim())
      .map((entry) => [entry.parameterKey, normalizeGuidanceText(entry.text)]),
  );
  const saved = new Map(
    settings?.orientations.map((entry) => [entry.sectionId, normalizeGuidanceText(entry.text)]) ?? [],
  );

  return Object.fromEntries(report.sections.map((section) => [
    section.id,
    saved.has(section.id)
      ? saved.get(section.id) ?? ""
      : section.parameterKey
        ? defaults.get(section.parameterKey) ?? ""
        : "",
  ]));
}

export function buildIndividualReportOrientations(
  report: ComplianceGeneratedReport,
  values: IndividualReportOrientationMap,
): IndividualReportOrientation[] {
  return report.sections.map((section) => ({
    sectionId: section.id,
    parameterKey: section.parameterKey ?? "",
    text: normalizeGuidanceText(values[section.id] ?? ""),
  }));
}
