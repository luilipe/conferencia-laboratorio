import type { CollectionSample, SourceFileMetadata } from "./types.ts";

export type AnalysisType = "Água" | "Efluente" | "Polidora" | "Extra";
export type AnalysisPeriodicity = "Mensal" | "Semestral" | "Sem periodicidade";
export type SchedulePublicationStatus = "Publicado" | "Parcialmente publicado" | "Pendente";
export type AnalysisMatchStatus = "matched" | "suggested" | "ambiguous" | "unmatched";
export type NotionTargetStatus = "pending" | "found" | "created" | "blocked" | "failed";
export type AnalysisMatchMethod =
  | "canonical-company"
  | "exact-alias"
  | "qualified-rule"
  | "fuzzy-suggestion"
  | "none";

export interface AnalysisClientQualifiers {
  identificationIncludes?: string[];
  identificationExcludes?: string[];
  sampleTypeIncludes?: string[];
}

export interface AnalysisClientRule {
  id: string;
  title: string;
  notionUrl?: string;
  aliases: string[];
  companyKeys: string[];
  analysisType: AnalysisType;
  periodicity: AnalysisPeriodicity;
  qualifiers: AnalysisClientQualifiers;
  active: boolean;
  updatedAt?: string | null;
  updatedByUid?: string;
  updatedByName?: string;
}

export interface AnalysisClientCandidate {
  ruleId: string;
  title: string;
  confidence: number;
}

export interface AnalysisClientResolution {
  status: AnalysisMatchStatus;
  method: AnalysisMatchMethod;
  rule: AnalysisClientRule | null;
  confidence: number;
  candidates: AnalysisClientCandidate[];
  warnings: string[];
}

export interface StoredAnalysisSample extends CollectionSample {
  id: string;
  sampleKey: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastUploadId: string;
  updatedByUid: string;
}

export interface AnalysisScheduleMonth {
  id: string;
  label: string;
  sortKey: string;
  sampleCount: number;
  publishedCount: number;
  pendingCount: number;
  lastImportAt: string | null;
  lastImportByName: string;
  updatedAt: string | null;
}

export interface AnalysisNotionDatabaseTarget {
  name: string;
  url: string;
}

export interface AnalysisNotionSettings {
  templateDatabaseName: string;
  templateDatabaseUrl: string;
  competenceDatabases: Record<string, AnalysisNotionDatabaseTarget>;
  promptVersion: number;
  updatedAt?: string | null;
  updatedByUid?: string;
  updatedByName?: string;
}

export interface AnalysisNotionProvisioningTarget {
  status: NotionTargetStatus;
  notionUrl?: string;
}

export interface AnalysisNotionProvisioningRequest {
  id: string;
  provisioningKey: string;
  competence: string;
  proposedRuleId: string;
  ruleId?: string;
  sourceCompany: string;
  proposedTitle: string;
  analysisType: AnalysisType;
  periodicity: AnalysisPeriodicity;
  sampleNumbers: string[];
  uploadIds: string[];
  collectionDates: string[];
  publicationDate: string;
  publicationStatus: SchedulePublicationStatus;
  currentTarget: AnalysisNotionProvisioningTarget;
  templateTarget: AnalysisNotionProvisioningTarget;
  catalogStatus: "pending" | "linked" | "blocked";
  promptVersion: number;
  requestedAt: string | null;
  requestedByUid: string;
  requestedByName: string;
  updatedAt: string | null;
  completedAt?: string | null;
  completedByUid?: string;
}

export type AnalysisNotionProvisioningDraft = Omit<
  AnalysisNotionProvisioningRequest,
  | "requestedAt"
  | "requestedByUid"
  | "requestedByName"
  | "updatedAt"
  | "completedAt"
  | "completedByUid"
>;

export interface AnalysisScheduleImport {
  id: string;
  fileName: string;
  fileSize: number;
  fileHash: string;
  status: "processing" | "completed" | "failed";
  totalSourceRows: number;
  uniqueSamples: number;
  insertedSamples: number;
  updatedSamples: number;
  unchangedSamples: number;
  importedByUid: string;
  importedByName: string;
  importedAt: string | null;
}

export interface AnalysisScheduleState {
  month: AnalysisScheduleMonth | null;
  samples: StoredAnalysisSample[];
  imports: AnalysisScheduleImport[];
}

export interface AnalysisSchedulePreview {
  inserted: CollectionSample[];
  updated: CollectionSample[];
  unchanged: CollectionSample[];
  outsideCompetence: CollectionSample[];
  mergedSamples: CollectionSample[];
}

export interface AnalysisCompetencePartition {
  competence: string;
  samples: CollectionSample[];
}

export interface AnalysisAutomaticPartition {
  months: AnalysisCompetencePartition[];
  invalidSamples: CollectionSample[];
}

export interface AnalysisCompetenceConflict {
  sampleNumber: string;
  collectionDate: string;
  detectedCompetence: string;
  existingCompetence: string;
}

export interface AnalysisScheduleGroup {
  id: string;
  clientTitle: string;
  notionUrl: string;
  sourceCompany: string;
  analysisType: AnalysisType;
  periodicity: AnalysisPeriodicity;
  collectionDates: string[];
  publicationDate: string;
  publicationStatus: SchedulePublicationStatus;
  sampleNumbers: string[];
  warnings: string[];
  resolutionStatus: AnalysisMatchStatus;
  resolutionMethod: AnalysisMatchMethod;
  matchConfidence: number;
  candidateTitles: string[];
  safeForNotion: boolean;
  lastUploadId: string;
  uploadIds: string[];
}

export interface NotionSchedulePayload {
  text: string;
  includedGroups: AnalysisScheduleGroup[];
  creationGroups: AnalysisScheduleGroup[];
  blockedGroups: AnalysisScheduleGroup[];
  provisioningRequests: AnalysisNotionProvisioningRequest[];
}

export interface AnalysisScheduleImportInput {
  competence: string;
  file: SourceFileMetadata;
  samples: CollectionSample[];
  preview: AnalysisSchedulePreview;
}

export interface PendingAnalysisRow {
  sampleNumber: string;
  client: string;
  collectionDate: string;
  identification: string;
  situation: string;
}

export interface PendingAnalysisReport {
  competence: string;
  competenceLabel: string;
  generatedAt: string;
  generatedBy: string;
  total: number;
  rows: PendingAnalysisRow[];
}
