import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type WriteBatch,
} from "firebase/firestore";
import { isCorporateEmail, normalizeEmail } from "./auth-policy";
import { buildCompliancePointSummaries, complianceMonthKey } from "./compliance";
import { normalizeGuidanceText } from "./compliance-guidance";
import { sampleKey } from "./reconciliation";
import {
  analysisSampleDocumentId,
  analysisScheduleMonthLabel,
  buildAutomaticAnalysisClientRule,
} from "./analysis-schedule";
import type {
  AnalysisClientQualifiers,
  AnalysisClientRule,
  AnalysisNotionProvisioningDraft,
  AnalysisNotionProvisioningRequest,
  AnalysisNotionSettings,
  AnalysisScheduleImport,
  AnalysisScheduleImportInput,
  AnalysisScheduleMonth,
  AnalysisScheduleState,
  NotionTargetStatus,
  StoredAnalysisSample,
} from "./analysis-schedule-types";
import type {
  ComplianceHistoryClient,
  ComplianceHistoryEntry,
  ComplianceHistoryMonth,
  ComplianceGuidance,
  ComplianceItem,
  ComplianceRunDraft,
  ComplianceRunRecord,
  IndividualReportOrientation,
  IndividualReportSettings,
  MonthlyExecutiveReport,
  MonthlyExecutiveReportDraft,
} from "./compliance-types";
import { getFirebaseServices } from "./firebase";
import type {
  ConferenceDraft,
  ConferenceRecord,
  ReconciliationItem,
  ReviewDecision,
  UserProfile,
} from "./types";

const WRITE_BATCH_LIMIT = 400;

export async function loadUserProfile(user: User): Promise<UserProfile | null> {
  const { db } = getFirebaseServices();
  const profileRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(profileRef);
  if (!snapshot.exists()) {
    if (!user.emailVerified || !isCorporateEmail(user.email)) return null;

    const profile: UserProfile = {
      uid: user.uid,
      displayName: user.displayName?.trim() || user.email?.split("@")[0] || "Usuário",
      email: normalizeEmail(user.email ?? ""),
      role: "reviewer",
      active: true,
    };
    await setDoc(profileRef, {
      displayName: profile.displayName,
      email: profile.email,
      role: profile.role,
      active: profile.active,
      createdAt: serverTimestamp(),
    });
    return profile;
  }
  const data = snapshot.data();
  return {
    uid: user.uid,
    displayName: String(data.displayName || user.displayName || user.email || "Usuário"),
    email: String(data.email || user.email || ""),
    role: data.role === "administrator" ? "administrator" : "reviewer",
    active: data.active === true,
  };
}

export async function createConference(
  draft: ConferenceDraft,
  user: User,
  profile: UserProfile,
): Promise<ConferenceRecord> {
  const { db } = getFirebaseServices();
  const conferenceRef = doc(collection(db, "conferences"));
  const conferenceData = {
    measurementNumber: draft.measurementNumber,
    competence: draft.competence,
    supplier: draft.supplier,
    status: draft.status,
    summary: draft.summary,
    pdfMetadata: draft.pdfMetadata,
    files: draft.files,
    createdByUid: user.uid,
    createdByName: profile.displayName,
    createdByEmail: profile.email,
    archivedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  for (let offset = 0; offset < draft.items.length; offset += WRITE_BATCH_LIMIT) {
    const batch = writeBatch(db);
    if (offset === 0) {
      batch.set(conferenceRef, conferenceData);
      const auditRef = doc(collection(conferenceRef, "auditEvents"));
      batch.set(auditRef, {
        action: "conference_created",
        actorUid: user.uid,
        actorName: profile.displayName,
        actorEmail: profile.email,
        details: {
          measurementNumber: draft.measurementNumber,
          billingItems: draft.summary.billingItems,
          collectedSamples: draft.summary.collectedSamples,
          divergentItems: draft.summary.divergentItems,
        },
        createdAt: serverTimestamp(),
      });
    }

    for (const item of draft.items.slice(offset, offset + WRITE_BATCH_LIMIT)) {
      batch.set(doc(conferenceRef, "items", item.id), item);
    }
    await batch.commit();
  }

  if (!draft.items.length) await setDoc(conferenceRef, conferenceData);

  const { items: _items, ...conference } = draft;
  void _items;
  return {
    id: conferenceRef.id,
    ...conference,
    createdByUid: user.uid,
    createdByName: profile.displayName,
    createdByEmail: profile.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function createComplianceRun(
  draft: ComplianceRunDraft,
  user: User,
  profile: UserProfile,
): Promise<ComplianceRunRecord> {
  const { db } = getFirebaseServices();
  const runRef = doc(collection(db, "complianceRuns"));
  const runData = {
    identity: draft.identity,
    ruleSetVersion: draft.ruleSetVersion,
    status: draft.status,
    periodLabel: draft.periodLabel,
    summary: draft.summary,
    files: draft.files,
    warnings: draft.warnings,
    report: draft.report,
    points: draft.points,
    createdByUid: user.uid,
    createdByName: profile.displayName,
    createdByEmail: profile.email,
    createdAt: serverTimestamp(),
  };
  const monthKey = complianceMonthKey(draft.periodLabel);
  const clientKey = complianceClientKey(draft.identity.cnpj, draft.identity.clientName);
  const monthRef = doc(db, "complianceHistory", monthKey);
  const clientRef = doc(monthRef, "clients", clientKey);
  const analysisRef = doc(clientRef, "analyses", runRef.id);

  const addHistoryIndex = (batch: WriteBatch) => {
    batch.set(monthRef, {
      label: complianceMonthLabel(monthKey),
      sortKey: monthKey,
      lastCreatedByUid: user.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    batch.set(clientRef, {
      clientName: draft.identity.clientName,
      cnpj: draft.identity.cnpj,
      facilityName: draft.identity.facilityName,
      lastCreatedByUid: user.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    batch.set(analysisRef, {
      runId: runRef.id,
      identity: draft.identity,
      periodLabel: draft.periodLabel,
      summary: draft.summary,
      ruleSetVersion: draft.ruleSetVersion,
      report: draft.report,
      points: draft.points,
      nonCompliances: draft.items.filter((item) => item.classification === "non_compliant"),
      files: draft.files,
      createdByUid: user.uid,
      createdByName: profile.displayName,
      createdByEmail: profile.email,
      createdAt: serverTimestamp(),
    });
  };

  if (!draft.items.length) {
    const batch = writeBatch(db);
    batch.set(runRef, runData);
    addHistoryIndex(batch);
    batch.set(doc(collection(runRef, "auditEvents")), {
      action: "compliance_run_created",
      actorUid: user.uid,
      actorName: profile.displayName,
      actorEmail: profile.email,
      details: draft.summary,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  }

  for (let offset = 0; offset < draft.items.length; offset += WRITE_BATCH_LIMIT) {
    const batch = writeBatch(db);
    if (offset === 0) {
      batch.set(runRef, runData);
      addHistoryIndex(batch);
      batch.set(doc(collection(runRef, "auditEvents")), {
        action: "compliance_run_created",
        actorUid: user.uid,
        actorName: profile.displayName,
        actorEmail: profile.email,
        details: draft.summary,
        createdAt: serverTimestamp(),
      });
    }
    for (const item of draft.items.slice(offset, offset + WRITE_BATCH_LIMIT)) {
      batch.set(doc(runRef, "items", item.id), item);
    }
    await batch.commit();
  }

  return {
    id: runRef.id,
    identity: draft.identity,
    ruleSetVersion: draft.ruleSetVersion,
    status: draft.status,
    periodLabel: draft.periodLabel,
    summary: draft.summary,
    files: draft.files,
    warnings: draft.warnings,
    report: draft.report,
    points: draft.points,
    createdByUid: user.uid,
    createdByName: profile.displayName,
    createdByEmail: profile.email,
    createdAt: new Date().toISOString(),
  };
}

export async function listComplianceGuidance(): Promise<ComplianceGuidance[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(collection(db, "complianceGuidance"));
  return snapshot.docs.map((entry) => {
    const data = entry.data();
    return {
      parameterKey: String(data.parameterKey || entry.id),
      parameterName: String(data.parameterName || entry.id),
      text: String(data.text || ""),
      active: data.active === true,
      updatedByUid: String(data.updatedByUid || ""),
      updatedByName: String(data.updatedByName || ""),
      updatedByEmail: String(data.updatedByEmail || ""),
      updatedAt: timestampToIso(data.updatedAt),
    };
  });
}

export async function saveComplianceGuidance(
  input: Pick<ComplianceGuidance, "parameterKey" | "parameterName" | "text">,
  user: User,
  profile: UserProfile,
): Promise<ComplianceGuidance> {
  const { db } = getFirebaseServices();
  const text = normalizeGuidanceText(input.text);
  const updatedAt = new Date().toISOString();
  await setDoc(doc(db, "complianceGuidance", input.parameterKey), {
    parameterKey: input.parameterKey,
    parameterName: input.parameterName,
    text,
    active: Boolean(text),
    updatedByUid: user.uid,
    updatedByName: profile.displayName,
    updatedByEmail: profile.email,
    updatedAt: serverTimestamp(),
  });
  return {
    parameterKey: input.parameterKey,
    parameterName: input.parameterName,
    text,
    active: Boolean(text),
    updatedByUid: user.uid,
    updatedByName: profile.displayName,
    updatedByEmail: profile.email,
    updatedAt,
  };
}

export async function saveIndividualReportSettings(
  runId: string,
  orientations: IndividualReportOrientation[],
  user: User,
  profile: UserProfile,
): Promise<IndividualReportSettings> {
  const { db } = getFirebaseServices();
  const normalized = orientations.map((entry) => ({
    sectionId: entry.sectionId,
    parameterKey: entry.parameterKey,
    text: normalizeGuidanceText(entry.text),
  }));
  const savedAt = new Date().toISOString();
  await setDoc(doc(db, "complianceRuns", runId, "individualReportSettings", "current"), {
    orientations: normalized,
    savedByUid: user.uid,
    savedByName: profile.displayName,
    savedByEmail: profile.email,
    savedAt: serverTimestamp(),
  });
  return {
    orientations: normalized,
    savedByUid: user.uid,
    savedByName: profile.displayName,
    savedByEmail: profile.email,
    savedAt,
  };
}

export async function listComplianceMonths(): Promise<ComplianceHistoryMonth[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(
    query(collection(db, "complianceHistory"), orderBy("sortKey", "desc"), limit(24)),
  );
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    label: String(entry.data().label || complianceMonthLabel(entry.id)),
    sortKey: String(entry.data().sortKey || entry.id),
    updatedAt: timestampToIso(entry.data().updatedAt),
  }));
}

export async function listComplianceClients(monthId: string): Promise<ComplianceHistoryClient[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(
    query(collection(db, "complianceHistory", monthId, "clients"), orderBy("clientName")),
  );
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    clientName: String(entry.data().clientName || "Cliente não identificado"),
    cnpj: String(entry.data().cnpj || ""),
    facilityName: String(entry.data().facilityName || ""),
    updatedAt: timestampToIso(entry.data().updatedAt),
  }));
}

export async function listComplianceHistoryEntries(
  monthId: string,
  clientId: string,
): Promise<ComplianceHistoryEntry[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(
    query(
      collection(db, "complianceHistory", monthId, "clients", clientId, "analyses"),
      orderBy("createdAt", "desc"),
      limit(100),
    ),
  );
  return Promise.all(snapshot.docs.map(async (entry) => {
    const data = entry.data();
    const runId = String(data.runId || entry.id);
    const settingsPromise = getDoc(
      doc(db, "complianceRuns", runId, "individualReportSettings", "current"),
    );
    let nonCompliances = data.nonCompliances;
    let points = data.points;
    let ruleSetVersion = String(data.ruleSetVersion || "");
    if (!Array.isArray(nonCompliances) || !Array.isArray(points)) {
      const itemsSnapshot = await getDocs(collection(db, "complianceRuns", runId, "items"));
      const items = itemsSnapshot.docs.map((item) => item.data() as ComplianceItem);
      if (!Array.isArray(nonCompliances)) {
        nonCompliances = items.filter((item) => item.classification === "non_compliant");
      }
      if (!Array.isArray(points)) points = buildCompliancePointSummaries(items);
    }
    if (!ruleSetVersion) {
      const runSnapshot = await getDoc(doc(db, "complianceRuns", runId));
      if (runSnapshot.exists()) ruleSetVersion = String(runSnapshot.data().ruleSetVersion || "");
    }
    const settingsSnapshot = await settingsPromise;
    return {
      id: entry.id,
      runId,
      identity: data.identity,
      periodLabel: String(data.periodLabel || ""),
      summary: data.summary,
      ruleSetVersion,
      report: data.report ?? null,
      individualReportSettings: settingsSnapshot.exists()
        ? mapIndividualReportSettings(settingsSnapshot.data())
        : null,
      points,
      nonCompliances,
      files: data.files ?? [],
      createdByName: String(data.createdByName || ""),
      createdByEmail: String(data.createdByEmail || ""),
      createdAt: timestampToIso(data.createdAt),
    } as ComplianceHistoryEntry;
  }));
}

function mapIndividualReportSettings(data: DocumentData): IndividualReportSettings {
  return {
    orientations: Array.isArray(data.orientations)
      ? data.orientations.map((entry: unknown) => {
        const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
        return {
          sectionId: String(value.sectionId || ""),
          parameterKey: String(value.parameterKey || ""),
          text: String(value.text || ""),
        };
      })
      : [],
    savedByUid: String(data.savedByUid || ""),
    savedByName: String(data.savedByName || ""),
    savedByEmail: String(data.savedByEmail || ""),
    savedAt: timestampToIso(data.savedAt),
  };
}

export async function saveMonthlyExecutiveReport(
  draft: MonthlyExecutiveReportDraft,
  user: User,
  profile: UserProfile,
): Promise<MonthlyExecutiveReport> {
  const { db } = getFirebaseServices();
  const reportRef = doc(db, "complianceMonthlyReports", draft.monthId);
  const versionRef = doc(collection(reportRef, "versions"));
  const generatedAt = new Date().toISOString();
  const reportData = {
    ...draft,
    versionId: versionRef.id,
    generatedByUid: user.uid,
    generatedByName: profile.displayName,
    generatedByEmail: profile.email,
    generatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(versionRef, reportData);
  batch.set(reportRef, {
    monthId: draft.monthId,
    monthLabel: draft.monthLabel,
    status: draft.status,
    summary: draft.summary,
    latestVersionId: versionRef.id,
    generatedByUid: user.uid,
    generatedByName: profile.displayName,
    generatedByEmail: profile.email,
    generatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return {
    ...draft,
    versionId: versionRef.id,
    generatedByUid: user.uid,
    generatedByName: profile.displayName,
    generatedByEmail: profile.email,
    generatedAt,
  };
}

export async function loadMonthlyExecutiveReport(
  monthId: string,
): Promise<MonthlyExecutiveReport | null> {
  const { db } = getFirebaseServices();
  const reportSnapshot = await getDoc(doc(db, "complianceMonthlyReports", monthId));
  if (!reportSnapshot.exists()) return null;
  const versionId = String(reportSnapshot.data().latestVersionId || "");
  if (!versionId) return null;
  const versionSnapshot = await getDoc(
    doc(db, "complianceMonthlyReports", monthId, "versions", versionId),
  );
  if (!versionSnapshot.exists()) return null;
  const data = versionSnapshot.data();
  return {
    monthId: String(data.monthId || monthId),
    monthLabel: String(data.monthLabel || monthId),
    status: data.status === "finalized" || data.status === "outdated" ? data.status : "draft",
    summary: data.summary,
    clients: data.clients ?? [],
    text: String(data.text || ""),
    sourceAnalysisIds: data.sourceAnalysisIds ?? [],
    ruleSetVersions: data.ruleSetVersions ?? [],
    versionId,
    generatedByUid: String(data.generatedByUid || ""),
    generatedByName: String(data.generatedByName || ""),
    generatedByEmail: String(data.generatedByEmail || ""),
    generatedAt: timestampToIso(data.generatedAt),
  };
}

export async function listConferences(): Promise<ConferenceRecord[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(
    query(collection(db, "conferences"), orderBy("createdAt", "desc"), limit(100)),
  );
  return snapshot.docs
    .filter((document) => !document.data().archivedAt)
    .slice(0, 30)
    .map((document) => mapConference(document.id, document.data()));
}

export async function listAnalysisScheduleMonths(): Promise<AnalysisScheduleMonth[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(
    query(collection(db, "analysisScheduleMonths"), orderBy("sortKey", "desc"), limit(36)),
  );
  return snapshot.docs.map((entry) => mapAnalysisScheduleMonth(entry.id, entry.data()));
}

export async function listAnalysisClientRules(): Promise<AnalysisClientRule[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(collection(db, "analysisClientRules"));
  return snapshot.docs
    .map((entry) => mapAnalysisClientRule(entry.id, entry.data()))
    .sort((left, right) => left.title.localeCompare(right.title, "pt-BR")
      || left.periodicity.localeCompare(right.periodicity, "pt-BR"));
}

export async function saveAnalysisClientRule(
  input: AnalysisClientRule,
  user: User,
  profile: UserProfile,
): Promise<AnalysisClientRule> {
  const { db } = getFirebaseServices();
  const id = input.id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  const title = input.title.trim();
  if (!id || !title) throw new Error("Informe a chave estável e o título do cliente.");
  const aliases = uniqueStrings(input.aliases);
  const companyKeys = uniqueStrings(input.companyKeys);
  if (!aliases.length && !companyKeys.length) {
    throw new Error("Cadastre pelo menos um alias ou nome canônico da empresa.");
  }
  const qualifiers = normalizeAnalysisQualifiers(input.qualifiers);
  const updatedAt = new Date().toISOString();
  const saved: AnalysisClientRule = {
    id,
    title,
    notionUrl: input.notionUrl?.trim() || "",
    aliases,
    companyKeys,
    analysisType: input.analysisType,
    periodicity: input.periodicity,
    qualifiers,
    active: input.active,
    updatedAt,
    updatedByUid: user.uid,
    updatedByName: profile.displayName,
  };
  await setDoc(doc(db, "analysisClientRules", id), {
    ...saved,
    updatedAt: serverTimestamp(),
    updatedByEmail: profile.email,
  }, { merge: true });
  return saved;
}

export async function listAnalysisNotionProvisioningRequests(
  competences?: string[],
): Promise<AnalysisNotionProvisioningRequest[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(collection(db, "analysisNotionProvisioningRequests"));
  const competenceSet = competences?.length ? new Set(competences) : null;
  return snapshot.docs
    .map((entry) => mapAnalysisNotionProvisioningRequest(entry.id, entry.data()))
    .filter((entry) => !competenceSet || competenceSet.has(entry.competence))
    .sort((left, right) => left.competence.localeCompare(right.competence)
      || left.proposedTitle.localeCompare(right.proposedTitle, "pt-BR"));
}

export async function saveAnalysisNotionProvisioningRequests(
  drafts: AnalysisNotionProvisioningDraft[],
  user: User,
  profile: UserProfile,
): Promise<AnalysisNotionProvisioningRequest[]> {
  if (!drafts.length) return [];
  const { db } = getFirebaseServices();
  for (const draft of drafts) {
    const requestRef = doc(db, "analysisNotionProvisioningRequests", draft.id);
    await runTransaction(db, async (transaction) => {
      const existingSnapshot = await transaction.get(requestRef);
      if (existingSnapshot.exists()) {
        const existing = mapAnalysisNotionProvisioningRequest(
          existingSnapshot.id,
          existingSnapshot.data(),
        );
        if (profile.role !== "administrator") return;
        transaction.set(requestRef, {
          provisioningKey: draft.provisioningKey,
          competence: draft.competence,
          proposedRuleId: existing.proposedRuleId || draft.proposedRuleId,
          sourceCompany: draft.sourceCompany,
          proposedTitle: existing.proposedTitle || draft.proposedTitle,
          analysisType: draft.analysisType,
          periodicity: draft.periodicity,
          sampleNumbers: uniqueStrings([...existing.sampleNumbers, ...draft.sampleNumbers]),
          uploadIds: uniqueStrings([...existing.uploadIds, ...draft.uploadIds]),
          collectionDates: uniqueStrings([...existing.collectionDates, ...draft.collectionDates]),
          publicationDate: draft.publicationDate || existing.publicationDate,
          publicationStatus: draft.publicationStatus,
          promptVersion: Math.max(existing.promptVersion, draft.promptVersion),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        return;
      }
      transaction.set(requestRef, {
        provisioningKey: draft.provisioningKey,
        competence: draft.competence,
        proposedRuleId: draft.proposedRuleId,
        sourceCompany: draft.sourceCompany,
        proposedTitle: draft.proposedTitle,
        analysisType: draft.analysisType,
        periodicity: draft.periodicity,
        sampleNumbers: draft.sampleNumbers,
        uploadIds: draft.uploadIds,
        collectionDates: draft.collectionDates,
        publicationDate: draft.publicationDate,
        publicationStatus: draft.publicationStatus,
        currentTarget: draft.currentTarget,
        templateTarget: draft.templateTarget,
        catalogStatus: draft.catalogStatus,
        promptVersion: draft.promptVersion,
        requestedAt: serverTimestamp(),
        requestedByUid: user.uid,
        requestedByName: profile.displayName,
        requestedByEmail: profile.email,
        updatedAt: serverTimestamp(),
      });
    });
  }
  return listAnalysisNotionProvisioningRequests([
    ...new Set(drafts.map((draft) => draft.competence)),
  ]).then((requests) => requests.filter((request) =>
    drafts.some((draft) => draft.id === request.id),
  ));
}

export interface AnalysisCatalogAutomationResult {
  requests: AnalysisNotionProvisioningRequest[];
  rules: AnalysisClientRule[];
  failures: Array<{ requestId: string; title: string; message: string }>;
}

export async function automateAnalysisCatalogProvisioning(
  drafts: AnalysisNotionProvisioningDraft[],
  existingRules: AnalysisClientRule[],
  user: User,
  profile: UserProfile,
): Promise<AnalysisCatalogAutomationResult> {
  const requests = await saveAnalysisNotionProvisioningRequests(drafts, user, profile);
  if (!requests.length) return { requests: [], rules: [], failures: [] };
  if (profile.role !== "administrator") {
    return {
      requests,
      rules: [],
      failures: requests.map((request) => ({
        requestId: request.id,
        title: request.proposedTitle,
        message: "Aguardando processamento automático por um administrador.",
      })),
    };
  }

  const rulesById = new Map(existingRules.map((rule) => [rule.id, rule]));
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const savedRules: AnalysisClientRule[] = [];
  const failures: AnalysisCatalogAutomationResult["failures"] = [];

  for (const request of requests) {
    if (request.catalogStatus === "linked" && request.ruleId) continue;
    const draft = drafts.find((entry) => entry.id === request.id);
    if (!draft) continue;
    try {
      const existing = rulesById.get(draft.proposedRuleId);
      if (existing && (
        existing.analysisType !== draft.analysisType
        || existing.periodicity !== draft.periodicity
      )) {
        throw new Error("A chave proposta já pertence a uma regra incompatível.");
      }
      const savedRule = await saveAnalysisClientRule(
        buildAutomaticAnalysisClientRule(draft, existing),
        user,
        profile,
      );
      rulesById.set(savedRule.id, savedRule);
      savedRules.push(savedRule);
      const linked = await linkAnalysisNotionProvisioningRequestToRule(
        request.id,
        savedRule.id,
        user,
        profile,
      );
      requestsById.set(linked.id, linked);
    } catch (cause) {
      failures.push({
        requestId: request.id,
        title: request.proposedTitle,
        message: cause instanceof Error ? cause.message : "Falha ao automatizar o catálogo.",
      });
    }
  }

  return {
    requests: [...requestsById.values()],
    rules: savedRules,
    failures,
  };
}

export async function linkAnalysisNotionProvisioningRequestToRule(
  requestId: string,
  ruleId: string,
  user: User,
  profile: UserProfile,
): Promise<AnalysisNotionProvisioningRequest> {
  if (profile.role !== "administrator") throw new Error("Somente administradores podem vincular o catálogo.");
  const { db } = getFirebaseServices();
  const requestRef = doc(db, "analysisNotionProvisioningRequests", requestId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists()) throw new Error("A solicitação de catálogo não está mais disponível.");
    const current = mapAnalysisNotionProvisioningRequest(snapshot.id, snapshot.data());
    const completed = targetCompleted(current.currentTarget.status)
      && targetCompleted(current.templateTarget.status);
    transaction.update(requestRef, {
      ruleId,
      catalogStatus: "linked",
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByName: profile.displayName,
      ...(completed ? {
        completedAt: serverTimestamp(),
        completedByUid: user.uid,
      } : {}),
    });
  });
  const snapshot = await getDoc(requestRef);
  if (!snapshot.exists()) throw new Error("A solicitação de catálogo não está mais disponível.");
  return mapAnalysisNotionProvisioningRequest(snapshot.id, snapshot.data());
}

export async function updateAnalysisNotionProvisioningTargets(
  requestId: string,
  input: {
    currentStatus: NotionTargetStatus;
    currentUrl?: string;
    templateStatus: NotionTargetStatus;
    templateUrl?: string;
  },
  user: User,
  profile: UserProfile,
): Promise<AnalysisNotionProvisioningRequest> {
  if (profile.role !== "administrator") throw new Error("Somente administradores podem confirmar o Notion.");
  const { db } = getFirebaseServices();
  const requestRef = doc(db, "analysisNotionProvisioningRequests", requestId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists()) throw new Error("A solicitação não está mais disponível.");
    const current = mapAnalysisNotionProvisioningRequest(snapshot.id, snapshot.data());
    const completed = targetCompleted(input.currentStatus)
      && targetCompleted(input.templateStatus)
      && current.catalogStatus === "linked";
    transaction.update(requestRef, {
      currentTarget: { status: input.currentStatus, notionUrl: input.currentUrl?.trim() || "" },
      templateTarget: { status: input.templateStatus, notionUrl: input.templateUrl?.trim() || "" },
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByName: profile.displayName,
      ...(completed ? {
        completedAt: serverTimestamp(),
        completedByUid: user.uid,
      } : {
        completedAt: null,
        completedByUid: "",
      }),
    });
  });
  const snapshot = await getDoc(requestRef);
  if (!snapshot.exists()) throw new Error("A solicitação não está mais disponível.");
  return mapAnalysisNotionProvisioningRequest(snapshot.id, snapshot.data());
}

export async function loadAnalysisNotionSettings(): Promise<AnalysisNotionSettings> {
  const { db } = getFirebaseServices();
  const snapshot = await getDoc(doc(db, "systemSettings", "analysisNotion"));
  return snapshot.exists()
    ? mapAnalysisNotionSettings(snapshot.data())
    : emptyAnalysisNotionSettings();
}

export async function saveAnalysisNotionSettings(
  input: AnalysisNotionSettings,
  user: User,
  profile: UserProfile,
): Promise<AnalysisNotionSettings> {
  if (profile.role !== "administrator") throw new Error("Somente administradores podem configurar o Notion.");
  const { db } = getFirebaseServices();
  const settings: AnalysisNotionSettings = {
    templateDatabaseName: input.templateDatabaseName.trim(),
    templateDatabaseUrl: input.templateDatabaseUrl.trim(),
    competenceDatabases: Object.fromEntries(Object.entries(input.competenceDatabases)
      .filter(([, target]) => target.name.trim() || target.url.trim())
      .map(([competence, target]) => [competence, {
        name: target.name.trim(),
        url: target.url.trim(),
      }])),
    promptVersion: Math.max(1, Number(input.promptVersion) || 1),
    updatedAt: new Date().toISOString(),
    updatedByUid: user.uid,
    updatedByName: profile.displayName,
  };
  await setDoc(doc(db, "systemSettings", "analysisNotion"), {
    ...settings,
    updatedAt: serverTimestamp(),
    updatedByEmail: profile.email,
  }, { merge: true });
  return settings;
}

export async function loadAnalysisScheduleState(
  competence: string,
): Promise<AnalysisScheduleState> {
  const { db } = getFirebaseServices();
  const monthRef = doc(db, "analysisScheduleMonths", competence);
  const [monthSnapshot, samplesSnapshot, importsSnapshot] = await Promise.all([
    getDoc(monthRef),
    getDocs(collection(monthRef, "samples")),
    getDocs(query(collection(monthRef, "imports"), orderBy("importedAt", "desc"), limit(50))),
  ]);
  return {
    month: monthSnapshot.exists()
      ? mapAnalysisScheduleMonth(monthSnapshot.id, monthSnapshot.data())
      : null,
    samples: samplesSnapshot.docs
      .map((entry) => mapStoredAnalysisSample(entry.id, entry.data()))
      .sort((left, right) => left.company.localeCompare(right.company, "pt-BR")
        || left.sampleNumber.localeCompare(right.sampleNumber, "pt-BR")),
    imports: importsSnapshot.docs.map((entry) => mapAnalysisScheduleImport(entry.id, entry.data())),
  };
}

export async function loadAnalysisScheduleSamples(
  competence: string,
): Promise<StoredAnalysisSample[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(collection(db, "analysisScheduleMonths", competence, "samples"));
  return snapshot.docs.map((entry) => mapStoredAnalysisSample(entry.id, entry.data()));
}

export async function saveAnalysisScheduleImport(
  input: AnalysisScheduleImportInput,
  user: User,
  profile: UserProfile,
): Promise<AnalysisScheduleState> {
  const { db } = getFirebaseServices();
  const monthRef = doc(db, "analysisScheduleMonths", input.competence);
  const importId = input.file.sha256;
  const importRef = doc(monthRef, "imports", importId);

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(importRef);
    if (existing.exists() && existing.data().status !== "failed") {
      throw new Error("Este mesmo arquivo já foi importado nesta competência.");
    }
    transaction.set(importRef, {
      fileName: input.file.name,
      fileSize: input.file.size,
      fileHash: input.file.sha256,
      status: "processing",
      totalSourceRows: input.samples.reduce((sum, sample) => sum + sample.sourceRows, 0),
      uniqueSamples: input.samples.length,
      insertedSamples: input.preview.inserted.length,
      updatedSamples: input.preview.updated.length,
      unchangedSamples: input.preview.unchanged.length,
      importedByUid: user.uid,
      importedByName: profile.displayName,
      importedByEmail: profile.email,
      importedAt: serverTimestamp(),
    }, { merge: existing.exists() });
  });

  try {
    const insertedKeys = new Set(input.preview.inserted.map((sample) => analysisSampleDocumentId(sample.sampleNumber)));
    for (let offset = 0; offset < input.samples.length; offset += WRITE_BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const sample of input.samples.slice(offset, offset + WRITE_BATCH_LIMIT)) {
        const sampleId = analysisSampleDocumentId(sample.sampleNumber);
        const sampleRef = doc(monthRef, "samples", sampleId);
        batch.set(sampleRef, {
          sampleKey: sampleKey(sample.sampleNumber),
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
          ...(insertedKeys.has(sampleId) ? { firstSeenAt: serverTimestamp() } : {}),
          lastSeenAt: serverTimestamp(),
          lastUploadId: importId,
          updatedByUid: user.uid,
          updatedByName: profile.displayName,
        }, { merge: true });
      }
      await batch.commit();
    }

    const publishedCount = input.preview.mergedSamples.filter((sample) =>
      Boolean(sample.publicationDate) && normalizeStatus(sample.sampleStatus) === "publicada",
    ).length;
    const batch = writeBatch(db);
    batch.set(monthRef, {
      label: analysisScheduleMonthLabel(input.competence),
      sortKey: input.competence,
      sampleCount: input.preview.mergedSamples.length,
      publishedCount,
      pendingCount: input.preview.mergedSamples.length - publishedCount,
      lastImportAt: serverTimestamp(),
      lastImportByUid: user.uid,
      lastImportByName: profile.displayName,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    batch.update(importRef, { status: "completed" });
    await batch.commit();
  } catch (cause) {
    await updateDoc(importRef, {
      status: "failed",
      failureMessage: cause instanceof Error ? cause.message.slice(0, 400) : "Falha não identificada.",
    });
    throw cause;
  }

  return loadAnalysisScheduleState(input.competence);
}

export async function loadConferenceItems(
  conferenceId: string,
): Promise<ReconciliationItem[]> {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(collection(db, "conferences", conferenceId, "items"));
  return snapshot.docs
    .map((document) =>
      mapReconciliationItem(document.id, document.data()),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function archiveConference(
  conferenceId: string,
  user: User,
  profile: UserProfile,
): Promise<void> {
  const { db } = getFirebaseServices();
  const conferenceRef = doc(db, "conferences", conferenceId);
  await updateDoc(conferenceRef, {
    archivedAt: serverTimestamp(),
    archivedByUid: user.uid,
    archivedByName: profile.displayName,
    archivedByEmail: profile.email,
    updatedAt: serverTimestamp(),
  });
}

export async function saveItemReview(options: {
  conferenceId: string;
  itemId: string;
  decision: ReviewDecision;
  comment: string;
  user: User;
  profile: UserProfile;
}): Promise<{ reviewedItems: number; pendingReviews: number; reviewedAt: string }> {
  const { db } = getFirebaseServices();
  const conferenceRef = doc(db, "conferences", options.conferenceId);
  const itemRef = doc(conferenceRef, "items", options.itemId);
  const reviewRef = doc(collection(itemRef, "reviews"));
  const auditRef = doc(collection(conferenceRef, "auditEvents"));
  const reviewedAt = new Date().toISOString();

  return runTransaction(db, async (transaction) => {
    const [conferenceSnapshot, itemSnapshot] = await Promise.all([
      transaction.get(conferenceRef),
      transaction.get(itemRef),
    ]);
    if (!conferenceSnapshot.exists() || !itemSnapshot.exists()) {
      throw new Error("A conferência ou o item não está mais disponível.");
    }

    const conference = conferenceSnapshot.data();
    const item = itemSnapshot.data();
    const previousDecision = (item.decision || "pending") as ReviewDecision;
    const wasReviewed = previousDecision !== "pending";
    const willBeReviewed = options.decision !== "pending";
    const currentReviewed = Number(conference.summary?.reviewedItems ?? 0);
    const reviewedItems = Math.max(
      0,
      currentReviewed + (willBeReviewed ? 1 : 0) - (wasReviewed ? 1 : 0),
    );
    const divergentItems = Number(conference.summary?.divergentItems ?? 0);
    const pendingReviews = Math.max(0, divergentItems - reviewedItems);

    transaction.update(itemRef, {
      decision: options.decision,
      reviewComment: options.comment,
      reviewedBy: options.profile.displayName,
      reviewedByUid: options.user.uid,
      reviewedAt: serverTimestamp(),
    });
    transaction.set(reviewRef, {
      decision: options.decision,
      comment: options.comment,
      previousDecision,
      actorUid: options.user.uid,
      actorName: options.profile.displayName,
      actorEmail: options.profile.email,
      createdAt: serverTimestamp(),
    });
    transaction.set(auditRef, {
      action: "item_reviewed",
      actorUid: options.user.uid,
      actorName: options.profile.displayName,
      actorEmail: options.profile.email,
      itemId: options.itemId,
      before: { decision: previousDecision },
      after: { decision: options.decision, comment: options.comment },
      createdAt: serverTimestamp(),
    });
    transaction.update(conferenceRef, {
      "summary.reviewedItems": reviewedItems,
      "summary.pendingReviews": pendingReviews,
      status: pendingReviews === 0 ? "reviewed" : "in_review",
      updatedAt: serverTimestamp(),
    });

    return { reviewedItems, pendingReviews, reviewedAt };
  });
}

function mapConference(id: string, data: DocumentData): ConferenceRecord {
  return {
    id,
    measurementNumber: String(data.measurementNumber ?? ""),
    competence: String(data.competence ?? ""),
    supplier: String(data.supplier ?? ""),
    status: data.status === "reviewed" ? "reviewed" : "in_review",
    summary: data.summary,
    pdfMetadata: data.pdfMetadata,
    files: data.files ?? [],
    createdByUid: String(data.createdByUid ?? ""),
    createdByName: String(data.createdByName ?? ""),
    createdByEmail: String(data.createdByEmail ?? ""),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

function mapAnalysisScheduleMonth(id: string, data: DocumentData): AnalysisScheduleMonth {
  return {
    id,
    label: String(data.label || analysisScheduleMonthLabel(id)),
    sortKey: String(data.sortKey || id),
    sampleCount: Number(data.sampleCount || 0),
    publishedCount: Number(data.publishedCount || 0),
    pendingCount: Number(data.pendingCount || 0),
    lastImportAt: timestampToIso(data.lastImportAt),
    lastImportByName: String(data.lastImportByName || ""),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

function mapAnalysisClientRule(id: string, data: DocumentData): AnalysisClientRule {
  const type = data.analysisType === "Efluente" || data.analysisType === "Polidora" || data.analysisType === "Extra"
    ? data.analysisType
    : "Água";
  const periodicity = data.periodicity === "Semestral" || data.periodicity === "Sem periodicidade"
    ? data.periodicity
    : "Mensal";
  return {
    id,
    title: String(data.title || id),
    notionUrl: String(data.notionUrl || ""),
    aliases: Array.isArray(data.aliases) ? uniqueStrings(data.aliases.map(String)) : [],
    companyKeys: Array.isArray(data.companyKeys) ? uniqueStrings(data.companyKeys.map(String)) : [],
    analysisType: type,
    periodicity,
    qualifiers: normalizeAnalysisQualifiers(data.qualifiers as AnalysisClientQualifiers | undefined),
    active: data.active !== false,
    updatedAt: timestampToIso(data.updatedAt),
    updatedByUid: String(data.updatedByUid || ""),
    updatedByName: String(data.updatedByName || ""),
  };
}

function mapAnalysisNotionProvisioningRequest(
  id: string,
  data: DocumentData,
): AnalysisNotionProvisioningRequest {
  const type = data.analysisType === "Efluente" || data.analysisType === "Polidora" || data.analysisType === "Extra"
    ? data.analysisType
    : "Água";
  const periodicity = data.periodicity === "Semestral" || data.periodicity === "Sem periodicidade"
    ? data.periodicity
    : "Mensal";
  const publicationStatus = data.publicationStatus === "Publicado"
    || data.publicationStatus === "Parcialmente publicado"
    ? data.publicationStatus
    : "Pendente";
  const catalogStatus = data.catalogStatus === "linked" || data.catalogStatus === "blocked"
    ? data.catalogStatus
    : "pending";
  return {
    id,
    provisioningKey: String(data.provisioningKey || id),
    competence: String(data.competence || ""),
    proposedRuleId: String(data.proposedRuleId || ""),
    ruleId: String(data.ruleId || "") || undefined,
    sourceCompany: String(data.sourceCompany || ""),
    proposedTitle: String(data.proposedTitle || data.sourceCompany || id),
    analysisType: type,
    periodicity,
    sampleNumbers: Array.isArray(data.sampleNumbers) ? uniqueStrings(data.sampleNumbers) : [],
    uploadIds: Array.isArray(data.uploadIds) ? uniqueStrings(data.uploadIds) : [],
    collectionDates: Array.isArray(data.collectionDates) ? uniqueStrings(data.collectionDates) : [],
    publicationDate: String(data.publicationDate || ""),
    publicationStatus,
    currentTarget: mapAnalysisNotionTarget(data.currentTarget),
    templateTarget: mapAnalysisNotionTarget(data.templateTarget),
    catalogStatus,
    promptVersion: Math.max(1, Number(data.promptVersion) || 1),
    requestedAt: timestampToIso(data.requestedAt),
    requestedByUid: String(data.requestedByUid || ""),
    requestedByName: String(data.requestedByName || ""),
    updatedAt: timestampToIso(data.updatedAt),
    completedAt: timestampToIso(data.completedAt),
    completedByUid: String(data.completedByUid || "") || undefined,
  };
}

function mapAnalysisNotionTarget(value: unknown): AnalysisNotionProvisioningRequest["currentTarget"] {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = data.status === "found"
    || data.status === "created"
    || data.status === "blocked"
    || data.status === "failed"
    ? data.status
    : "pending";
  return { status, notionUrl: String(data.notionUrl || "") };
}

function emptyAnalysisNotionSettings(): AnalysisNotionSettings {
  return {
    templateDatabaseName: "Modelo do acompanhamento de análises",
    templateDatabaseUrl: "",
    competenceDatabases: {},
    promptVersion: 1,
  };
}

function mapAnalysisNotionSettings(data: DocumentData): AnalysisNotionSettings {
  const rawTargets = data.competenceDatabases && typeof data.competenceDatabases === "object"
    ? data.competenceDatabases as Record<string, unknown>
    : {};
  const competenceDatabases = Object.fromEntries(Object.entries(rawTargets).map(([competence, value]) => {
    const target = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return [competence, { name: String(target.name || ""), url: String(target.url || "") }];
  }));
  return {
    templateDatabaseName: String(data.templateDatabaseName || "Modelo do acompanhamento de análises"),
    templateDatabaseUrl: String(data.templateDatabaseUrl || ""),
    competenceDatabases,
    promptVersion: Math.max(1, Number(data.promptVersion) || 1),
    updatedAt: timestampToIso(data.updatedAt),
    updatedByUid: String(data.updatedByUid || ""),
    updatedByName: String(data.updatedByName || ""),
  };
}

function targetCompleted(status: NotionTargetStatus): boolean {
  return status === "found" || status === "created";
}

function mapStoredAnalysisSample(id: string, data: DocumentData): StoredAnalysisSample {
  return {
    id,
    sampleKey: String(data.sampleKey || id),
    sampleNumber: String(data.sampleNumber || ""),
    code: String(data.code || ""),
    proposal: String(data.proposal || ""),
    identification: String(data.identification || ""),
    sampleType: String(data.sampleType || ""),
    company: String(data.company || ""),
    collectionDate: String(data.collectionDate || ""),
    publicationDate: String(data.publicationDate || ""),
    opinion: String(data.opinion || ""),
    sampleStatus: String(data.sampleStatus || ""),
    analyses: Array.isArray(data.analyses) ? data.analyses.map(String) : [],
    sourceFiles: Array.isArray(data.sourceFiles) ? data.sourceFiles.map(String) : [],
    sourceRows: Number(data.sourceRows || 0),
    firstSeenAt: timestampToIso(data.firstSeenAt),
    lastSeenAt: timestampToIso(data.lastSeenAt),
    lastUploadId: String(data.lastUploadId || ""),
    updatedByUid: String(data.updatedByUid || ""),
  };
}

function mapAnalysisScheduleImport(id: string, data: DocumentData): AnalysisScheduleImport {
  const status = data.status === "completed" || data.status === "failed" ? data.status : "processing";
  return {
    id,
    fileName: String(data.fileName || ""),
    fileSize: Number(data.fileSize || 0),
    fileHash: String(data.fileHash || id),
    status,
    totalSourceRows: Number(data.totalSourceRows || 0),
    uniqueSamples: Number(data.uniqueSamples || 0),
    insertedSamples: Number(data.insertedSamples || 0),
    updatedSamples: Number(data.updatedSamples || 0),
    unchangedSamples: Number(data.unchangedSamples || 0),
    importedByUid: String(data.importedByUid || ""),
    importedByName: String(data.importedByName || ""),
    importedAt: timestampToIso(data.importedAt),
  };
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeAnalysisQualifiers(value: AnalysisClientQualifiers | undefined): AnalysisClientQualifiers {
  return {
    identificationIncludes: uniqueStrings(value?.identificationIncludes ?? []),
    identificationExcludes: uniqueStrings(value?.identificationExcludes ?? []),
    sampleTypeIncludes: uniqueStrings(value?.sampleTypeIncludes ?? []),
  };
}

function mapReconciliationItem(
  id: string,
  data: DocumentData,
): ReconciliationItem {
  return {
    ...(data as Omit<ReconciliationItem, "id" | "reviewedAt">),
    id,
    reviewedAt: timestampToIso(data.reviewedAt),
  };
}

function complianceClientKey(cnpj: string, clientName: string): string {
  const digits = cnpj.replace(/\D/g, "");
  if (digits) return digits;
  return clientName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "cliente-nao-identificado";
}

function complianceMonthLabel(monthKey: string): string {
  if (monthKey === "periodo-nao-identificado") return "Período não identificado";
  const names = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  const match = monthKey.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) return monthKey;
  return `${names[Number(match[2]) - 1]} de ${match[1]}`;
}

function timestampToIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return date.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}
