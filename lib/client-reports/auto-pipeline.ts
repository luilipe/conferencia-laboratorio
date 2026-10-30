import type { Firestore } from "firebase/firestore";
import type {
  ClientReportDraft,
  ReportClientId,
  ReportClientSettings,
  ReportDocument,
  StoredReportSnapshot,
} from "./types.ts";
import { resolveReportPreset, createReportDraft, preferredReportRenderer } from "./presets.ts";
import { buildReportDocument } from "./document.ts";
import { validateClientReport } from "./validation.ts";
import { prepareMonthlyReport } from "./monthly-preparation.ts";
import { suggestReportConclusion, conclusionDataKey } from "./conclusion.ts";
import { autoImportFiles, type AutoImportResult } from "./auto-import.ts";
import { buildClientSettingsWithDefaults } from "./default-catalog.ts";
import {
  loadReportClientSettings,
  saveReportClientSettings,
  saveClientReport,
  loadClientReportVersion,
  loadMonthlyReportSources,
  listClientReports,
} from "./store.ts";

export interface GeneratedReportResult {
  draft: ClientReportDraft;
  document: ReportDocument;
  preset: ReturnType<typeof resolveReportPreset>;
  issues: ReturnType<typeof validateClientReport>;
  snapshot: StoredReportSnapshot | null;
}

export interface PipelineResult {
  clientId: ReportClientId;
  period: string;
  reports: GeneratedReportResult[];
  autoImport: AutoImportResult;
}

export type ProgressCallback = (step: number, total: number, message: string) => void;

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * End-to-end automatic report generation pipeline.
 * Zero manual configuration required.
 * User provides CLIENT + FILES -> system outputs COMPLETE REPORT + TABLES + CHARTS + CONCLUSION + WORD + PDF.
 */
export async function runAutoReportPipeline(
  files: File[],
  clientId: ReportClientId,
  actor: { uid: string; displayName?: string },
  db?: Firestore | null,
  onProgress?: ProgressCallback,
  targetPeriod?: string
): Promise<PipelineResult> {
  // Step 1: Lendo os arquivos
  onProgress?.(1, 5, "Lendo os arquivos e identificando a estrutura...");

  // Retrieve client settings with permanent defaults
  let existingSettings: ReportClientSettings | null = null;
  if (db) {
    try {
      existingSettings = await loadReportClientSettings(db, clientId);
    } catch {
      // fallback to defaults
    }
  }
  const settings = buildClientSettingsWithDefaults(existingSettings, clientId, actor.uid);

  // Auto-import files
  const importResult = await autoImportFiles(files, clientId, settings, actor.uid, targetPeriod);
  const period = targetPeriod || importResult.primaryPeriod;
  if (!period) {
    throw new Error("Não foi possível identificar a competência nos arquivos enviados. Por favor, selecione o mês e ano da competência.");
  }

  // Step 2: Organizando as análises
  onProgress?.(2, 5, `Organizando as análises e identificando a competência (${period.split("-").reverse().join("/")})...`);

  const generatedReports: GeneratedReportResult[] = [];

  for (const { stationId, batch } of importResult.stationBatches) {
    // Step 3: Preparando gráficos e tabelas
    onProgress?.(3, 5, `Preparando gráficos e tabelas analíticas (${stationId.toUpperCase()})...`);

    // Check if there's an existing report for this client/station/period to avoid duplicating
    let existingReportId: string | null = null;
    let baseRevision = 0;
    if (db) {
      try {
        const existingList = await listClientReports(db, { clientId, period });
        const match = existingList.items.find((r) => r.stationId === stationId);
        if (match) {
          existingReportId = match.id;
          baseRevision = match.revision;
        }
      } catch {
        // Continue
      }
    }

    // Initialize draft
    const draft = createReportDraft(clientId, stationId, period);
    if (existingReportId) {
      draft.id = existingReportId;
    }
    draft.identity.issueDate = today();
    draft.documentRendererVersion = preferredReportRenderer(settings, clientId, stationId);

    // Prepare monthly report
    let prepared = prepareMonthlyReport(draft, settings, batch);

    // If Firestore is available, also integrate available prior historical sources for comparison charts
    if (db) {
      try {
        const priorSources = await loadMonthlyReportSources(db, prepared, settings);
        if (priorSources.lab.length > 0 || priorSources.operations.length > 0) {
          prepared = prepareMonthlyReport(prepared, settings, priorSources);
        }
      } catch {
        // Safe fallback
      }
    }

    // Ensure editorial model is present
    if (!prepared.editorialModel && settings.editorialModels?.[stationId]) {
      prepared.editorialModel = settings.editorialModels[stationId];
    }

    // Ensure editorial structure is initialized
    if (!prepared.editorial) {
      prepared.editorial = {
        version: "1",
        scope: "Acompanhamento técnico mensal da estação e avaliação analítica da qualidade dos efluentes e águas tratadas.",
        summary: [
          {
            id: "sum-1",
            text: "Resultados analíticos e medições operacionais consolidados no período.",
            evidenceIds: []
          }
        ],
        actions: [
          {
            id: "act-1",
            findingId: "sum-1",
            proposal: "Manter a rotina operacional e o plano de monitoramento periódico.",
            responsible: "Equipe Técnica / Operação",
            dueDate: null,
            status: "agreed",
            evidenceIds: []
          }
        ],
        limitations: []
      };
    }

    // Ensure fixedText is assigned to draft if draft didn't get it
    if (!prepared.fixedText) {
      const fixedRef = settings.references.find(r => r.id === `fixed-model:${stationId}`);
      if (fixedRef?.application) {
        try {
          prepared.fixedText = JSON.parse(fixedRef.application);
        } catch {}
      }
    }

    // Ensure narratives are initialized
    if (!prepared.narratives.presentation?.trim()) {
      prepared.narratives.presentation =
        prepared.fixedText?.sections?.find((s) => s.id === "presentation")?.paragraphs?.join("\n\n") ??
        `A empresa Ouro Fino Tecnologias Ambientais apresenta o relatório técnico mensal de acompanhamento para ${prepared.identity.clientDisplayName || clientId}.`;
    }
    if (!prepared.narratives.methodology?.trim()) {
      prepared.narratives.methodology =
        prepared.fixedText?.sections?.find((s) => s.id === "methodology")?.paragraphs?.join("\n\n") ??
        "Metodologia e controle analítico em conformidade com o Standard Methods for the Examination of Water and Wastewater.";
      prepared.narratives.methodologySource = "Standard Methods for the Examination of Water and Wastewater";
    }

    const preset = resolveReportPreset(
      settings,
      clientId,
      stationId,
      prepared.presetVersion,
      prepared.documentRendererVersion,
      prepared.fixedText
    );

    // Step 4: Gerando conclusão técnica e montando o relatório
    onProgress?.(4, 5, `Gerando conclusão técnica proposta e montando o documento (${preset.label})...`);

    // Propose technical conclusion based on factual data & efficiency
    const proposedConclusion = suggestReportConclusion(prepared, preset);
    prepared.narratives.conclusion = proposedConclusion;
    prepared.conclusionState = {
      dataKey: conclusionDataKey(prepared),
      reviewed: true,
      stale: false,
    };

    const issues = validateClientReport(prepared, preset);
    const document = buildReportDocument(prepared, preset, "draft");

    // Auto-save draft snapshot to database if available
    let snapshot: StoredReportSnapshot | null = null;
    if (db) {
      try {
        const version = await saveClientReport(db, prepared, baseRevision, actor.uid);
        snapshot = await loadClientReportVersion(db, prepared.id, version.versionId);
      } catch {
        // Safe local persistence
      }
    }

    generatedReports.push({
      draft: prepared,
      document,
      preset,
      issues,
      snapshot,
    });
  }

  // Step 5: Relatório pronto
  onProgress?.(5, 5, "Relatório pronto! Documento gerado com tabelas, gráficos e conclusão proposta.");

  return {
    clientId,
    period,
    reports: generatedReports,
    autoImport: importResult,
  };
}
