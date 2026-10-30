export type ComplianceClassification =
  | "non_compliant"
  | "inconsistent"
  | "coverage_not_proven"
  | "no_rule"
  | "compliant"
  | "informational";

export type CompliancePointType =
  | "source"
  | "treatment"
  | "consumption"
  | "unknown";

export type ComplianceFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "conditional"
  | "not_defined";

export type ResultOperator = "<" | "<=" | "=" | ">=" | ">" | "qualitative";

export interface ComplianceFileMetadata {
  name: string;
  size: number;
  sha256: string;
  pages: number;
  documentType: "laboratory_report" | "sisagua_monthly" | "sisagua_semiannual" | "unknown";
}

export interface ComplianceIdentity {
  clientName: string;
  cnpj: string;
  responsibleInstitution: string;
  facilityName: string;
  sisaguaCode: string;
  municipality: string;
  state: string;
  sourceType: "groundwater" | "surface" | "unknown";
  confidence: "high" | "medium" | "low";
}

export interface ComplianceResult {
  id: string;
  sampleNumber: string;
  sampleType: string;
  pointLabel: string;
  pointType: CompliancePointType;
  collectionDate: string;
  parameterKey: string;
  parameterName: string;
  resultRaw: string;
  operator: ResultOperator;
  value: number | null;
  unit: string;
  lq: string;
  ld: string;
  sourceFile: string;
  sourcePage: number;
  laboratoryConclusion: "meets" | "does_not_meet" | "not_declared";
  laboratoryConclusionRaw: string;
}

export interface SisaguaPointSummary {
  pointType: "treatment" | "consumption";
  samplesAnalyzed: number | null;
  percentile95: number | null;
  aboveMaximum: number | null;
  inRange: number | null;
  belowMinimum: number | null;
}

export interface SisaguaMonthlySummary {
  month: string;
  year: string;
  freeChlorine: SisaguaPointSummary[];
  sourceFile: string;
}

export interface ParsedComplianceBatch {
  identity: ComplianceIdentity;
  results: ComplianceResult[];
  monthlySummaries: SisaguaMonthlySummary[];
  files: ComplianceFileMetadata[];
  warnings: string[];
}

export type LegalRuleOperator = "max" | "min" | "range" | "absence" | "informational";

export interface LegalRule {
  id: string;
  parameterKey: string;
  parameterName: string;
  aliases: string[];
  category:
    | "microbiological"
    | "operational"
    | "inorganic"
    | "organic"
    | "pesticide"
    | "disinfection_byproduct"
    | "cyanotoxin"
    | "radioactivity"
    | "organoleptic";
  operator: LegalRuleOperator;
  minimum: number | null;
  maximum: number | null;
  unit: string;
  appliesTo: CompliancePointType[];
  frequency: ComplianceFrequency;
  legalReference: string;
  legalSourceUrl: string;
  note: string;
}

export interface ComplianceItem extends ComplianceResult {
  classification: ComplianceClassification;
  ruleId: string | null;
  ruleDescription: string;
  legalReference: string;
  legalSourceUrl: string;
  frequency: ComplianceFrequency;
  note: string;
}

export interface ComplianceSummary {
  files: number;
  samples: number;
  parameters: number;
  compliant: number;
  nonCompliant: number;
  inconsistent: number;
  coverageNotProven: number;
  withoutRule: number;
  informational: number;
  attentionItems: number;
}

export type CompliancePointStatus = "non_compliant" | "attention" | "compliant";

export interface CompliancePointSummary {
  key: string;
  label: string;
  pointType: CompliancePointType;
  sampleNumbers: string[];
  samples: number;
  parameters: number;
  nonCompliant: number;
  attentionItems: number;
  status: CompliancePointStatus;
}

export interface ComplianceReportSection {
  id: string;
  marker: "red" | "amber" | "green";
  heading: string;
  parameterKey?: string;
  pointLabel?: string;
  parameterName?: string;
  result: string;
  standardLabel?: string;
  standardValue?: string;
  situation: string;
  classification: ComplianceClassification;
  sampleNumber: string;
  sourceFile: string;
}

export interface ComplianceGeneratedReport {
  title: string;
  sections: ComplianceReportSection[];
  text: string;
}

export interface ComplianceGuidance {
  parameterKey: string;
  parameterName: string;
  text: string;
  active: boolean;
  updatedByUid: string;
  updatedByName: string;
  updatedByEmail: string;
  updatedAt: string | null;
}

export interface IndividualReportOrientation {
  sectionId: string;
  parameterKey: string;
  text: string;
}

export interface IndividualReportSettings {
  orientations: IndividualReportOrientation[];
  savedByUid: string;
  savedByName: string;
  savedByEmail: string;
  savedAt: string | null;
}

export type IndividualReportOrientationMap = Record<string, string>;

export interface ComplianceRunDraft {
  identity: ComplianceIdentity;
  ruleSetVersion: string;
  status: "completed";
  periodLabel: string;
  summary: ComplianceSummary;
  files: ComplianceFileMetadata[];
  warnings: string[];
  report: ComplianceGeneratedReport | null;
  points: CompliancePointSummary[];
  items: ComplianceItem[];
}

export interface ComplianceRunRecord extends Omit<ComplianceRunDraft, "items"> {
  id: string;
  createdByUid: string;
  createdByName: string;
  createdByEmail: string;
  createdAt: string | null;
}

export interface ComplianceHistoryMonth {
  id: string;
  label: string;
  sortKey: string;
  updatedAt: string | null;
}

export interface ComplianceHistoryClient {
  id: string;
  clientName: string;
  cnpj: string;
  facilityName: string;
  updatedAt: string | null;
}

export interface ComplianceHistoryEntry {
  id: string;
  runId: string;
  identity: ComplianceIdentity;
  periodLabel: string;
  summary: ComplianceSummary;
  ruleSetVersion: string;
  report: ComplianceGeneratedReport | null;
  individualReportSettings: IndividualReportSettings | null;
  points: CompliancePointSummary[];
  nonCompliances: ComplianceItem[];
  files: ComplianceFileMetadata[];
  createdByName: string;
  createdByEmail: string;
  createdAt: string | null;
}

export interface MonthlyNonComplianceOccurrence {
  id: string;
  analysisId: string;
  sampleNumber: string;
  collectionDate: string;
  result: string;
  unit: string;
  ruleDescription: string;
  legalReference: string;
  laboratoryDeclaredNonCompliance: boolean;
  sourceFile: string;
}

export interface MonthlyParameterGroup {
  key: string;
  name: string;
  occurrences: MonthlyNonComplianceOccurrence[];
}

export interface MonthlyPositionGroup {
  key: string;
  name: string;
  order: number;
  parameters: MonthlyParameterGroup[];
}

export interface MonthlyLocationGroup {
  key: string;
  name: string;
  positions: MonthlyPositionGroup[];
}

export interface MonthlyClientGroup {
  key: string;
  name: string;
  cnpj: string;
  locations: MonthlyLocationGroup[];
}

export interface MonthlyExecutiveReport {
  monthId: string;
  monthLabel: string;
  status: "draft" | "finalized" | "outdated";
  summary: {
    analysesReviewed: number;
    affectedClients: number;
    affectedLocations: number;
    nonCompliances: number;
  };
  clients: MonthlyClientGroup[];
  text: string;
  sourceAnalysisIds: string[];
  ruleSetVersions: string[];
  versionId: string;
  generatedByUid: string;
  generatedByName: string;
  generatedByEmail: string;
  generatedAt: string | null;
}

export type MonthlyExecutiveReportDraft = Omit<
  MonthlyExecutiveReport,
  "versionId" | "generatedByUid" | "generatedByName" | "generatedByEmail" | "generatedAt"
>;
