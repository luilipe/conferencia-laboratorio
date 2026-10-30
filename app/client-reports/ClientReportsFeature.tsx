"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FileDown,
  UploadCloud,
  ChevronDown,
  RotateCcw,
  Check,
  AlertTriangle,
  Info,
  Shield,
  Eye,
  Settings,
  Search,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import type { UserProfile } from "@/lib/types";
import { getFirebaseServices } from "@/lib/firebase";
import type {
  ClientReportDraft,
  ReportClientId,
  ReportClientSettings,
  ReportSummary,
  StoredReportSnapshot,
  ReportVersionSummary,
  ReferenceRule,
  IdentitySeed,
  ReportDocument,
} from "@/lib/client-reports/types";
import { REPORT_PRESETS, resolveReportPreset, preferredReportRenderer } from "@/lib/client-reports/presets";
import { buildReportDocument } from "@/lib/client-reports/document";
import { validateClientReport } from "@/lib/client-reports/validation";
import {
  loadMonthlyReportSources,
  saveClientReport,
  loadClientReportVersion,
  finalizeClientReport,
  listClientReports,
  listClientReportVersions,
  loadReportClientSettings,
  saveReportClientSettings,
  reportSha256,
} from "@/lib/client-reports/store";
import { IDENTITY_LABELS, emptyReportIdentity } from "@/lib/client-reports/identity";
import { IdentityImport } from "./IdentityImport";
import { downloadReportBlob } from "./ReportImport";
import { ReportPreview } from "./ReportPreview";
import { CLIENT_LIST, buildClientSettingsWithDefaults } from "@/lib/client-reports/default-catalog";
import { runAutoReportPipeline, type PipelineResult, type GeneratedReportResult } from "@/lib/client-reports/auto-pipeline";
import { updateConclusionState, suggestReportConclusion, conclusionDataKey } from "@/lib/client-reports/conclusion";
import { ModernReportSettings } from "./ModernReportSettings";
import { reportPdfPreviewKey } from "@/lib/client-reports/pdf-preview";
import { downloadReportPdf } from "@/lib/client-reports/remote-services";

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function ClientReportsFeature({ user, profile }: { user: User; profile: UserProfile }) {
  const db = getFirebaseServices().db;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selected client state
  const [selectedClientId, setSelectedClientId] = useState<ReportClientId>("demo13");
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);

  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);

  // Automated pipeline state
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [pipelineProgress, setPipelineProgress] = useState<{ step: number; total: number; message: string } | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [activeReportIdx, setActiveReportIdx] = useState(0);

  // Report viewing & review state
  const [draft, setDraft] = useState<ClientReportDraft | null>(null);
  const [stored, setStored] = useState<StoredReportSnapshot | null>(null);
  const [settings, setSettings] = useState<ReportClientSettings | null>(null);
  const [versions, setVersions] = useState<ReportVersionSummary[]>([]);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showTechnicalReview, setShowTechnicalReview] = useState(false);

  // Administration & settings
  const [showSettings, setShowSettings] = useState(false);
  const [identityProposal, setIdentityProposal] = useState<IdentitySeed | null>(null);

  // History state
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filterClient, setFilterClient] = useState<string>("");
  const [filterPeriod, setFilterPeriod] = useState<string>("");

  const selectedClient = useMemo(
    () => CLIENT_LIST.find((c) => c.id === selectedClientId) ?? CLIENT_LIST[0],
    [selectedClientId]
  );

  const filteredClients = useMemo(
    () =>
      CLIENT_LIST.filter(
        (c) =>
          c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
          c.shortName.toLowerCase().includes(clientSearch.toLowerCase())
      ),
    [clientSearch]
  );

  // Load client settings when client changes
  useEffect(() => {
    let alive = true;
    void loadReportClientSettings(db, selectedClientId).then((s) => {
      if (alive) {
        setSettings(buildClientSettingsWithDefaults(s, selectedClientId, user.uid));
      }
    });
    return () => {
      alive = false;
    };
  }, [db, selectedClientId, user.uid]);

  // Load report history
  const history = useCallback(
    async (after?: string) => {
      try {
        const page = await listClientReports(
          db,
          { clientId: (filterClient || undefined) as ReportClientId | undefined, period: filterPeriod || undefined },
          after
        );
        setReports((previous) => (after ? [...previous, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (e) {
        // history unavailable
      }
    },
    [db, filterClient, filterPeriod]
  );

  useEffect(() => {
    void history();
  }, [history]);

  // Prevent unload if unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const preset = useMemo(() => {
    if (!draft) return null;
    return resolveReportPreset(
      settings,
      draft.clientId,
      draft.stationId,
      draft.presetVersion,
      draft.documentRendererVersion,
      draft.fixedText
    );
  }, [draft, settings]);

  const issues = useMemo(() => {
    if (!draft || !preset) return [];
    return validateClientReport(draft, preset);
  }, [draft, preset]);

  const content = useMemo(() => {
    if (!draft || !preset) return null;
    return stored && !dirty ? stored.document : buildReportDocument(draft, preset, "draft");
  }, [draft, preset, stored, dirty]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy(false);
    }
  };

  // --- AUTOMATIC GENERATION TRIGGER ---
  const handleFilesReceived = async (files: File[]) => {
    if (!files.length) return;
    setError("");
    setNotice("");
    setPipelineProgress({ step: 1, total: 5, message: "Lendo os arquivos e identificando a estrutura..." });

    try {
      const result = await runAutoReportPipeline(
        files,
        selectedClientId,
        { uid: user.uid, displayName: profile.displayName },
        db,
        (step, total, message) => {
          setPipelineProgress({ step, total, message });
        },
        selectedPeriod
      );

      setPipelineResult(result);
      setSelectedPeriod(result.period);
      setActiveReportIdx(0);

      const activeReport = result.reports[0];
      if (activeReport) {
        setDraft(activeReport.draft);
        setStored(activeReport.snapshot);
        setDirty(false);
        setReviewed(false);
      }

      await history();
      setNotice(
        `Relatório gerado com sucesso para ${selectedClient.shortName} (${result.period.split("-").reverse().join("/")}). Pronto para visualização e download.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha durante o processamento automático dos arquivos.");
    } finally {
      setPipelineProgress(null);
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFilesReceived(Array.from(e.dataTransfer.files));
    }
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleFilesReceived(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  // Switch between stations (for multi-station clients like Demo13)
  const switchReportStation = (idx: number) => {
    if (!pipelineResult || !pipelineResult.reports[idx]) return;
    setActiveReportIdx(idx);
    const r = pipelineResult.reports[idx];
    setDraft(r.draft);
    setStored(r.snapshot);
    setDirty(false);
    setReviewed(false);
  };

  // Downloads
  const download = async (format: "docx" | "pdf" | "xlsx") => {
    if (!content || !draft) return;
    const exporter = await import("@/lib/client-reports/export");
    let blob: Blob;
    if (format === "docx") {
      blob = await exporter.exportReportDocx(content);
    } else if (format === "pdf") {
      try {
        if (content.rendererVersion === "4" && stored?.version.sha256 && !dirty) {
          blob = await downloadReportPdf({
            reportId: stored.draft.id,
            versionId: stored.version.versionId,
            expectedSha256: stored.version.sha256,
          });
        } else {
          blob = await exporter.exportReportPdf(content);
        }
      } catch {
        blob = await exporter.exportReportPdf(content);
      }
    } else {
      blob = await exporter.exportReportXlsx(draft, content.mode);
    }
    downloadReportBlob(blob, exporter.reportFileName(content, format));
  };

  // Open existing report from history
  const openReport = async (report: ReportSummary, versionId = report.currentVersionId) => {
    const snapshot = await loadClientReportVersion(db, report.id, versionId);
    setSelectedClientId(snapshot.draft.clientId);
    setDraft(snapshot.draft);
    setStored(snapshot);
    setSettings(buildClientSettingsWithDefaults(await loadReportClientSettings(db, snapshot.draft.clientId), snapshot.draft.clientId, user.uid));
    setVersions(await listClientReportVersions(db, report.id));
    setPipelineResult({
      clientId: snapshot.draft.clientId,
      period: snapshot.draft.period,
      reports: [{
        draft: snapshot.draft,
        document: snapshot.document,
        preset: resolveReportPreset(null, snapshot.draft.clientId, snapshot.draft.stationId, snapshot.draft.presetVersion),
        issues: validateClientReport(snapshot.draft, resolveReportPreset(null, snapshot.draft.clientId, snapshot.draft.stationId, snapshot.draft.presetVersion)),
        snapshot,
      }],
      autoImport: {
        primaryPeriod: snapshot.draft.period,
        allPeriodsFound: [snapshot.draft.period],
        conflictingPeriods: [],
        stationBatches: [],
        sources: snapshot.draft.data.sources,
        summary: {
          totalFiles: snapshot.draft.data.sources.length,
          totalLabRecords: snapshot.draft.data.lab.length,
          totalOperationRecords: snapshot.draft.data.operations.length,
          stations: [snapshot.draft.stationId],
          parameters: [],
        },
      },
    });
    setDirty(false);
    setReviewed(false);
  };

  // Technical Save / Finalize
  const save = async () => {
    if (!draft) return;
    const nextDraft = structuredClone(draft);
    nextDraft.identity.issueDate = today();
    const version = await saveClientReport(db, nextDraft, draft.revision, user.uid);
    const snapshot = await loadClientReportVersion(db, draft.id, version.versionId);
    setDraft(snapshot.draft);
    setStored(snapshot);
    setDirty(false);
    setReviewed(false);
    setVersions(await listClientReportVersions(db, draft.id));
    await history();
    setNotice(`Versão ${version.revision} salva com sucesso.`);
  };

  const finalize = async () => {
    if (!draft || !stored) return;
    if (dirty || !reviewed) {
      throw new Error("Salve as alterações locais e confirme a revisão técnica antes de finalizar.");
    }
    const version = await finalizeClientReport(db, draft.id, stored.version.versionId, draft.revision, {
      actorUid: user.uid,
      actorName: profile.displayName,
      acceptedWarnings: issues.filter((i) => i.severity === "warning").map((i) => ({ issueId: i.id, reason: draft.acknowledgements[i.id]?.reason ?? "" })),
    });
    const snapshot = await loadClientReportVersion(db, draft.id, version.versionId);
    setStored(snapshot);
    setDraft(snapshot.draft);
    setDirty(false);
    setReviewed(false);
    await history();
    setNotice(`Versão ${version.revision} aprovada tecnicamente por ${profile.displayName}.`);
  };

  const resetToNew = () => {
    setDraft(null);
    setStored(null);
    setPipelineResult(null);
    setDirty(false);
    setReviewed(false);
    setError("");
    setNotice("");
  };

  return (
    <div className="client-reports reports-stack max-w-4xl mx-auto pt-8 pb-12 px-4">
      {/* Notifications and errors */}
      {error && (
        <div className="alert error-alert flex items-start gap-3 p-4 rounded-xl border border-red-800 bg-red-950/40 text-red-200" role="alert">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400 mt-0.5" />
          <div className="flex-1 text-sm leading-relaxed">{error}</div>
        </div>
      )}
      {notice && (
        <div className="alert success-alert flex items-start gap-3 p-4 rounded-xl border border-emerald-800 bg-emerald-950/40 text-emerald-200" role="status">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
          <div className="flex-1 text-sm leading-relaxed">{notice}</div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 1. NEW REPORT CREATION CARD (TWO-STEP RADICALLY SIMPLIFIED) */}
      {/* ============================================================== */}
      {!pipelineResult && !draft && (
        <section
          style={{
            background: "var(--surface)",
            borderColor: "var(--line)",
          }}
          className="border rounded-2xl p-6 sm:p-8 shadow-xl space-y-6"
        >
          <div
            style={{ borderColor: "var(--line)" }}
            className="flex items-center justify-between pb-3 border-b"
          >
            <div>
              <h1
                style={{ color: "var(--ink)" }}
                className="text-2xl font-bold tracking-tight flex items-center gap-2"
              >
                Novo relatório
              </h1>
              <p
                style={{ color: "var(--muted)" }}
                className="text-xs mt-1"
              >
                Geração automática de relatórios técnicos ambientais Ouro Fino
              </p>
            </div>
            <div className="flex items-center gap-2">
              {profile.role === "administrator" && (
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  style={{
                    background: "transparent",
                    color: "var(--muted)",
                    borderColor: "var(--line)",
                  }}
                  className="text-xs px-2.5 py-1 rounded-full border hover:text-[var(--ink)] flex items-center gap-1 transition"
                  title="Configurar modelos e parâmetros"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Cadastro técnico</span>
                </button>
              )}
              <span
                style={{
                  background: "var(--surface-soft)",
                  color: "var(--teal-700)",
                  borderColor: "var(--line)",
                }}
                className="text-xs px-3 py-1 rounded-full border font-medium"
              >
                Automação documental
              </span>
            </div>
          </div>

          {/* Campo 1 — Selecione o cliente */}
          <div className="space-y-2">
            <label
              style={{ color: "var(--ink)" }}
              className="text-sm font-semibold block"
            >
              1. Selecione o cliente
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setClientDropdownOpen(!clientDropdownOpen)}
                style={{
                  background: "var(--surface-soft)",
                  borderColor: "var(--line)",
                  color: "var(--ink)",
                }}
                className="w-full flex items-center justify-between border rounded-xl px-4 py-3.5 text-left transition hover:border-[var(--teal-700)] focus:outline-none focus:ring-2 focus:ring-[var(--teal-700)]"
              >
                <div>
                  <div className="font-semibold text-sm">{selectedClient.name}</div>
                  <div style={{ color: "var(--muted)" }} className="text-xs mt-0.5">
                    {selectedClient.stations.map((s) => s.systemType).join(" · ")}
                  </div>
                </div>
                <ChevronDown style={{ color: "var(--muted)" }} className="w-5 h-5 transition" />
              </button>

              {clientDropdownOpen && (
                <div
                  style={{
                    background: "var(--surface)",
                    borderColor: "var(--line)",
                  }}
                  className="absolute z-30 mt-2 w-full border rounded-xl shadow-2xl overflow-hidden"
                >
                  <div
                    style={{ borderColor: "var(--line)", background: "var(--surface-soft)" }}
                    className="p-2 border-b flex items-center gap-2"
                  >
                    <Search style={{ color: "var(--muted)" }} className="w-4 h-4 ml-2" />
                    <input
                      type="text"
                      placeholder="Pesquisar cliente..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      style={{ color: "var(--ink)" }}
                      className="w-full bg-transparent border-0 text-sm focus:outline-none p-1.5"
                      autoFocus
                    />
                  </div>
                  <ul
                    style={{ borderColor: "var(--line)" }}
                    className="max-h-60 overflow-y-auto divide-y divide-[var(--line)] p-1"
                  >
                    {filteredClients.map((client) => (
                      <li key={client.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClientId(client.id);
                            setClientDropdownOpen(false);
                            setClientSearch("");
                          }}
                          style={{
                            background: selectedClientId === client.id ? "var(--teal-100)" : "transparent",
                            color: selectedClientId === client.id ? "var(--teal-700)" : "var(--ink)",
                          }}
                          className="w-full text-left p-3 rounded-lg hover:bg-[var(--surface-soft)] transition flex items-center justify-between font-medium"
                        >
                          <div>
                            <div className="text-sm font-medium">{client.name}</div>
                            <div style={{ color: "var(--muted)" }} className="text-xs">
                              {client.stations.map((s) => s.label.split(" — ")[0]).join(" & ")}
                            </div>
                          </div>
                          {selectedClientId === client.id && (
                            <Check style={{ color: "var(--teal-700)" }} className="w-4 h-4" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Client retrieved badge summary */}
            <div
              style={{ color: "var(--muted)" }}
              className="flex flex-wrap items-center gap-2 text-xs pt-1"
            >
              <span
                style={{ color: "var(--teal-700)" }}
                className="flex items-center gap-1 font-medium"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Modelo recuperado
              </span>
              <span>·</span>
              <span>Instalações: {selectedClient.stations.map((s) => s.label.split(" — ")[0]).join(", ")}</span>
              <span>·</span>
              <span>Textos técnicos permanentes carregados</span>
            </div>
          </div>

          {/* Campo 2 — Importe os dados do mês */}
          <div className="space-y-2">
            <label
              style={{ color: "var(--ink)" }}
              className="text-sm font-semibold block"
            >
              2. Importe os dados do mês
            </label>

            {/* Large Drag & Drop Box */}
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                borderColor: isDragging ? "var(--teal-700)" : "var(--line)",
                background: isDragging ? "var(--teal-100)" : "var(--surface-soft)",
              }}
              className="border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-3 hover:border-[var(--teal-700)]"
            >
              <div
                style={{
                  background: "var(--surface)",
                  borderColor: "var(--line)",
                  color: "var(--teal-700)",
                }}
                className="w-12 h-12 rounded-xl border flex items-center justify-center shadow-inner"
              >
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <p style={{ color: "var(--ink)" }} className="text-base font-semibold">
                  Arraste os arquivos ou clique para selecionar
                </p>
                <p style={{ color: "var(--muted)" }} className="text-xs mt-1">
                  Planilhas Excel, laudos PDF e arquivos compatíveis
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.pdf,.txt,.json"
                onChange={onFileInputChange}
                className="hidden"
              />
            </div>
          </div>

          {/* Bottom informative card */}
          <div
            style={{
              borderColor: "var(--line)",
              background: "var(--surface-soft)",
            }}
            className="p-4 rounded-xl border flex items-start gap-3"
          >
            <CheckCircle2
              style={{ color: "var(--teal-700)" }}
              className="w-5 h-5 flex-shrink-0 mt-0.5"
            />
            <div className="space-y-1">
              <h4
                style={{ color: "var(--teal-700)" }}
                className="text-sm font-semibold"
              >
                O restante é automático
              </h4>
              <p
                style={{ color: "var(--muted)" }}
                className="text-xs leading-relaxed"
              >
                O sistema identifica o mês, recupera o modelo do cliente, organiza os resultados, gera os gráficos e monta o relatório completo.
              </p>
            </div>
          </div>

          <div
            style={{ color: "var(--muted)" }}
            className="flex items-center justify-center gap-2 text-xs pt-2"
          >
            <FileText className="w-4 h-4 opacity-75" />
            <span>Relatório disponível em Word e PDF após o processamento</span>
          </div>
        </section>
      )}

      {/* ============================================================== */}
      {/* PROCESSING PROGRESS INDICATOR */}
      {/* ============================================================== */}
      {pipelineProgress && (
        <section
          style={{ background: "var(--surface)", borderColor: "var(--line)" }}
          className="border rounded-2xl p-8 text-center space-y-4 shadow-xl animate-pulse"
        >
          <div
            style={{ borderColor: "var(--teal-700)", borderTopColor: "transparent" }}
            className="w-12 h-12 rounded-full border-2 animate-spin mx-auto"
          />
          <div>
            <h3 style={{ color: "var(--ink)" }} className="text-lg font-bold">{pipelineProgress.message}</h3>
            <p style={{ color: "var(--muted)" }} className="text-xs mt-1">
              Etapa {pipelineProgress.step} de {pipelineProgress.total} · Processamento automatizado
            </p>
          </div>
          <div style={{ background: "var(--surface-soft)" }} className="w-full h-2 rounded-full overflow-hidden max-w-md mx-auto">
            <div
              style={{
                width: `${(pipelineProgress.step / pipelineProgress.total) * 100}%`,
                background: "var(--teal-700)",
              }}
              className="h-full transition-all duration-300"
            />
          </div>
        </section>
      )}

      {/* ============================================================== */}
      {/* 2. GENERATED REPORT PREVIEW & DIRECT DOWNLOADS */}
      {/* ============================================================== */}
      {draft && content && (
        <section className="space-y-6">
          {/* Action Header Card */}
          <div
            style={{ background: "var(--surface)", borderColor: "var(--line)" }}
            className="border rounded-2xl p-6 shadow-xl space-y-4"
          >
            <div style={{ borderColor: "var(--line)" }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      background: content.mode === "draft" ? "var(--teal-100)" : "var(--green-100)",
                      color: content.mode === "draft" ? "var(--teal-700)" : "var(--green-700)",
                      borderColor: "var(--line)",
                    }}
                    className="text-xs px-2.5 py-0.5 rounded-full border font-medium"
                  >
                    {content.mode === "draft" ? "RASCUNHO GERADO" : "FINALIZADO"}
                  </span>
                  <span style={{ color: "var(--muted)" }} className="text-xs font-medium">
                    Competência {content.period.split("-").reverse().join("/")}
                  </span>
                </div>
                <h2 style={{ color: "var(--ink)" }} className="text-xl font-bold mt-1">
                  {content.identity.clientDisplayName || selectedClient.name}
                </h2>
                <p style={{ color: "var(--muted)" }} className="text-xs">
                  Estação: {draft.stationId.toUpperCase()} · Versão {draft.revision}
                </p>
              </div>

              {/* Station Toggle (for clients with multiple stations, e.g. DEMO13) */}
              {pipelineResult && pipelineResult.reports.length > 1 && (
                <div
                  style={{ background: "var(--surface-soft)", borderColor: "var(--line)" }}
                  className="flex items-center gap-1 p-1 rounded-xl border"
                >
                  {pipelineResult.reports.map((r, i) => (
                    <button
                      key={r.draft.stationId}
                      type="button"
                      onClick={() => switchReportStation(i)}
                      style={{
                        background: activeReportIdx === i ? "var(--teal-700)" : "transparent",
                        color: activeReportIdx === i ? "#fff" : "var(--muted)",
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium transition"
                    >
                      {r.draft.stationId.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Direct Download Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => download("docx"))}
                  style={{ background: "var(--teal-700)", color: "#fff" }}
                  className="px-5 py-2.5 rounded-xl font-semibold text-sm shadow flex items-center gap-2 transition hover:opacity-90"
                >
                  <FileText className="w-4 h-4" /> Baixar Word
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => download("pdf"))}
                  style={{ background: "var(--surface-soft)", borderColor: "var(--line)", color: "var(--ink)" }}
                  className="px-5 py-2.5 rounded-xl border font-semibold text-sm shadow flex items-center gap-2 transition hover:border-[var(--teal-700)]"
                >
                  <FileDown className="w-4 h-4 text-red-400" /> Baixar PDF
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => download("xlsx"))}
                  style={{ background: "var(--surface-soft)", borderColor: "var(--line)", color: "var(--ink)" }}
                  className="px-4 py-2.5 rounded-xl border font-medium text-sm flex items-center gap-2 transition hover:border-[var(--teal-700)]"
                >
                  <FileSpreadsheet className="w-4 h-4 text-[var(--teal-700)]" /> Planilha
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowTechnicalReview(!showTechnicalReview)}
                  style={{ background: "var(--surface-soft)", borderColor: "var(--line)", color: "var(--ink)" }}
                  className="px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition hover:border-[var(--teal-700)]"
                >
                  <Shield className="w-3.5 h-3.5" />
                  {showTechnicalReview ? "Ocultar revisão técnica" : "Revisão técnica"}
                </button>
                <button
                  type="button"
                  onClick={resetToNew}
                  style={{ background: "var(--surface-soft)", borderColor: "var(--line)", color: "var(--muted)" }}
                  className="px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition hover:text-[var(--ink)] hover:border-[var(--line)]"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Novo relatório
                </button>
              </div>
            </div>
          </div>

          {/* Collapsible Technical Review Panel */}
          {showTechnicalReview && (
            <div
              style={{ background: "var(--surface)", borderColor: "var(--line)" }}
              className="border rounded-2xl p-6 shadow-xl space-y-6"
            >
              <div style={{ borderColor: "var(--line)" }} className="flex items-center justify-between pb-3 border-b">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  Revisão e aprovação técnica
                </h3>
                <span className="text-xs text-zinc-400">
                  {issues.filter((i) => i.severity === "blocker").length} impedimentos · {issues.filter((i) => i.severity === "warning").length} avisos
                </span>
              </div>

              {/* Proposed Conclusion editable area */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300">
                    Proposta de conclusão técnica (gerada automaticamente):
                  </label>
                  <button
                    type="button"
                    className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
                    onClick={() => {
                      if (!preset) return;
                      const next = {
                        ...draft,
                        narratives: { ...draft.narratives, conclusion: suggestReportConclusion(draft, preset) },
                        conclusionState: { dataKey: conclusionDataKey(draft), reviewed: false, stale: false },
                      };
                      setDraft(next);
                      setDirty(true);
                      setReviewed(false);
                    }}
                  >
                    <Sparkles className="w-3 h-3" /> Recalcular proposta
                  </button>
                </div>
                <textarea
                  rows={6}
                  value={draft.narratives.conclusion ?? ""}
                  onChange={(e) => {
                    setDraft(updateConclusionState(draft, { ...draft, narratives: { ...draft.narratives, conclusion: e.target.value } }));
                    setDirty(true);
                    setReviewed(false);
                  }}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm text-zinc-100 font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              {/* Issues and alerts */}
              {issues.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-semibold text-zinc-300">Pendências e avisos identificados:</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {issues.map((issue) => (
                      <div
                        key={issue.id}
                        className={`text-xs p-3 rounded-lg border flex items-start gap-2 ${
                          issue.severity === "blocker"
                            ? "bg-red-950/20 border-red-900 text-red-200"
                            : "bg-amber-950/20 border-amber-900 text-amber-200"
                        }`}
                      >
                        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-semibold">{issue.severity === "blocker" ? "Impedimento" : "Aviso"}:</p>
                          <p>{issue.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Finalization Action */}
              <div className="pt-4 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={dirty || busy}
                    onChange={(e) => setReviewed(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 bg-zinc-800 border-zinc-700 focus:ring-emerald-500"
                  />
                  <span>Confirmo a revisão técnica dos resultados e da proposta de conclusão desta versão salva.</span>
                </label>

                <div className="flex items-center gap-2">
                  {dirty && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(save)}
                      className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold"
                    >
                      Salvar alterações
                    </button>
                  )}
                  {content.mode === "draft" && (
                    <button
                      type="button"
                      disabled={busy || !reviewed || dirty || issues.some((i) => i.severity === "blocker")}
                      onClick={() => void run(finalize)}
                      className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow"
                    >
                      Aprovar e finalizar emissão
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Complete Document Preview */}
          <ReportPreview
            document={content}
            issues={issues}
            onFinalize={finalize}
            onDownload={download}
          />
        </section>
      )}

      {/* ============================================================== */}
      {/* 3. REPORT HISTORY TABLE BY CLIENT */}
      {/* ============================================================== */}
      <section
        style={{ background: "var(--surface)", borderColor: "var(--line)" }}
        className="border rounded-2xl p-6 shadow-xl space-y-4"
      >
        <div style={{ borderColor: "var(--line)" }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b">
          <div>
            <h2 style={{ color: "var(--ink)" }} className="text-lg font-bold">Histórico de relatórios</h2>
            <p style={{ color: "var(--muted)" }} className="text-xs">Consultar e reabrir relatórios gerados</p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filterClient}
              onChange={(e) => setFilterClient(e.target.value)}
              style={{ background: "var(--surface-soft)", borderColor: "var(--line)", color: "var(--ink)" }}
              className="border text-xs rounded-lg px-2.5 py-1.5 focus:outline-none"
            >
              <option value="">Todos os clientes</option>
              {CLIENT_LIST.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shortName}
                </option>
              ))}
            </select>
            <input
              type="month"
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value)}
              style={{ background: "var(--surface-soft)", borderColor: "var(--line)", color: "var(--ink)" }}
              className="border text-xs rounded-lg px-2.5 py-1.5 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr style={{ borderColor: "var(--line)", color: "var(--muted)" }} className="border-b">
                <th className="py-2.5 px-3">Cliente / Estação</th>
                <th className="py-2.5 px-3">Competência</th>
                <th className="py-2.5 px-3">Versão</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody style={{ borderColor: "var(--line)", color: "var(--ink)" }} className="divide-y divide-[var(--line)]">
              {reports.map((r) => {
                const client = CLIENT_LIST.find((c) => c.id === r.clientId);
                return (
                  <tr key={r.id} className="hover:bg-zinc-900/50 transition">
                    <td className="py-2.5 px-3 font-medium">
                      {client?.shortName ?? r.clientId} · {r.stationId.toUpperCase()}
                    </td>
                    <td className="py-2.5 px-3">{r.period.split("-").reverse().join("/")}</td>
                    <td className="py-2.5 px-3">v{r.revision}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          r.status === "finalized"
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {r.status === "finalized" ? "Finalizado" : "Rascunho"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => void run(() => openReport(r))}
                        className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium transition"
                      >
                        Abrir
                      </button>
                    </td>
                  </tr>
                );
              })}
              {reports.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-zinc-500">
                    Nenhum relatório encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {cursor && (
          <button
            type="button"
            onClick={() => void run(() => history(cursor))}
            className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium rounded-xl border border-zinc-800 transition"
          >
            Carregar mais relatórios
          </button>
        )}

        {profile.role === "administrator" && (
          <div className="pt-3 border-t border-zinc-800 flex justify-end">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition"
            >
              <Settings className="w-3.5 h-3.5" /> Cadastro administrativo de modelos
            </button>
          </div>
        )}
      </section>

      {/* Administrator Technical Settings Modal */}
      {showSettings && profile.role === "administrator" && (
        <ReportSettingsModal
          clientId={draft?.clientId ?? selectedClientId}
          settings={settings}
          proposal={identityProposal}
          actorUid={user.uid}
          onClose={() => setShowSettings(false)}
          onSave={async (next) => {
            await run(async () => {
              await saveReportClientSettings(db, next, user.uid, settings);
              setSettings(buildClientSettingsWithDefaults(await loadReportClientSettings(db, next.clientId), next.clientId, user.uid));
              setShowSettings(false);
              setNotice("Cadastro técnico administrativo salvo.");
            });
          }}
        />
      )}
    </div>
  );
}

function ReportSettingsModal({
  clientId,
  settings,
  actorUid,
  onSave,
  onClose,
  proposal,
}: {
  clientId: ReportClientId;
  settings: ReportClientSettings | null;
  actorUid: string;
  onSave: (settings: ReportClientSettings) => Promise<void>;
  onClose: () => void;
  proposal?: IdentitySeed | null;
}) {
  const initial =
    settings?.clientId === clientId
      ? settings
      : { clientId, identities: {}, mappings: [], enabledPresetVersions: [], references: [], updatedByUid: actorUid };
  const [value, setValue] = useState<ReportClientSettings>(() => structuredClone(initial));
  const [station, setStation] = useState(proposal?.stationId ?? REPORT_PRESETS.find((p) => p.clientId === clientId)!.stationId);
  const [map, setMap] = useState({ labId: "mr-ambiental", companyAlias: "", identification: "", stationId: station, pointId: "" });
  const [ref, setRef] = useState({ parameter: "", pointId: "", unit: "", min: "", max: "", source: "", version: "", application: "" });
  const [error, setError] = useState("");

  const preset = resolveReportPreset(value, clientId, station);
  const identity = { ...emptyReportIdentity(), postalCode: "", city: "", state: "", phone: "", stateRegistration: "", ...value.identities[station] };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-zinc-950 border border-zinc-700 rounded-2xl max-w-3xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-white">Cadastro administrativo e homologação técnica</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white text-sm">
            ✕
          </button>
        </div>

        <div className="space-y-4 text-xs text-zinc-300">
          <label className="block space-y-1">
            <span className="font-semibold text-zinc-200">Modelo / Estação:</span>
            <select
              value={station}
              onChange={(e) => {
                setStation(e.target.value);
                setMap((m) => ({ ...m, stationId: e.target.value, pointId: "" }));
              }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-white"
            >
              {REPORT_PRESETS.filter((p) => p.clientId === clientId).map((p) => (
                <option key={p.stationId} value={p.stationId}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(identity).map(([key, text]) => (
              <label key={key} className="block space-y-1">
                <span className="text-zinc-400">{(IDENTITY_LABELS as Record<string, string>)[key] || key}:</span>
                <input
                  value={text}
                  onChange={(e) =>
                    setValue((v) => ({
                      ...v,
                      identities: {
                        ...v.identities,
                        [station]: { ...identity, [key]: e.target.value },
                      },
                    }))
                  }
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-white"
                />
              </label>
            ))}
          </div>

          <ModernReportSettings value={value} station={station} actorUid={actorUid} onChange={setValue} />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="pt-4 border-t border-zinc-800 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200 text-xs font-semibold">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void onSave({ ...value, updatedByUid: actorUid })}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
          >
            Salvar cadastro administrativo
          </button>
        </div>
      </div>
    </div>
  );
}
