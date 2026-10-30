export type Classification =
  | "ok"
  | "revision_mismatch"
  | "billing_without_collection"
  | "collection_without_billing"
  | "data_mismatch"
  | "duplicate_billing";

export type Severity = "low" | "medium" | "high";
export type ReviewDecision = "pending" | "approved" | "contested";
export type ConferenceStatus = "in_review" | "reviewed";

export interface SourceFileMetadata {
  name: string;
  size: number;
  type: "pdf" | "excel";
  sha256: string;
}

export interface BillingItem {
  account: string;
  sampleNumber: string;
  identification: string;
  sampleType: string;
  price: number;
  page: number;
}

export interface CollectionSample {
  sampleNumber: string;
  code: string;
  proposal: string;
  identification: string;
  sampleType: string;
  company: string;
  collectionDate: string;
  publicationDate: string;
  opinion: string;
  sampleStatus: string;
  analyses: string[];
  sourceFiles: string[];
  sourceRows: number;
}

export interface PdfMetadata {
  measurementNumber: string;
  sentDate: string;
  orderDate: string;
  contractor: string;
  pages: number;
  reportedTotal: number | null;
  extractedTotal: number;
}

export interface ReconciliationItem {
  id: string;
  classification: Classification;
  severity: Severity;
  pdfSampleNumber: string | null;
  excelSampleNumber: string | null;
  pdfCompany: string | null;
  excelCompany: string | null;
  pdfIdentification: string | null;
  excelIdentification: string | null;
  pdfSampleType: string | null;
  excelSampleType: string | null;
  pdfPage: number | null;
  chargedPrice: number;
  collectionDate: string | null;
  sampleStatus: string | null;
  analysesCount: number;
  sourceFiles: string[];
  companyMatches: boolean | null;
  identificationMatches: boolean | null;
  typeMatches: boolean | null;
  note: string;
  decision: ReviewDecision;
  reviewComment: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface ConferenceSummary {
  billingItems: number;
  collectedSamples: number;
  matchedOk: number;
  revisionMismatches: number;
  billingWithoutCollection: number;
  collectionWithoutBilling: number;
  dataMismatches: number;
  duplicateBilling: number;
  sourceDuplicates: number;
  divergentItems: number;
  reviewedItems: number;
  pendingReviews: number;
  billedTotal: number;
  reportedTotal: number | null;
  valueUnderReview: number;
}

export interface ConferenceDraft {
  measurementNumber: string;
  competence: string;
  supplier: string;
  status: ConferenceStatus;
  summary: ConferenceSummary;
  pdfMetadata: PdfMetadata;
  files: SourceFileMetadata[];
  items: ReconciliationItem[];
}

export interface ConferenceRecord extends Omit<ConferenceDraft, "items"> {
  id: string;
  createdByUid: string;
  createdByName: string;
  createdByEmail: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: "administrator" | "reviewer";
  active: boolean;
}
