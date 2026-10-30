"use client";

import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  Download,
  FileDown,
  FileSpreadsheet,
  History,
  LoaderCircle,
  MessageCircle,
  PlusCircle,
  RefreshCw,
  Search,
  Settings2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import type { User } from "firebase/auth";
import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analysisScheduleMonthLabel,
  buildAnalysisNotionProvisioningDrafts,
  buildPendingAnalysisReport,
  buildAnalysisSchedulePreview,
  findAnalysisCompetenceConflicts,
  generateWhatsAppPendingText,
  generateNotionScheduleText,
  groupAnalysisScheduleSamples,
  partitionSamplesByCollectionMonth,
} from "@/lib/analysis-schedule";
import {
  DEFAULT_ANALYSIS_CLIENT_RULES,
  mergeAnalysisClientRules,
} from "@/lib/analysis-client-rules";
import type {
  AnalysisClientRule,
  AnalysisCompetenceConflict,
  AnalysisNotionProvisioningRequest,
  AnalysisNotionSettings,
  AnalysisSchedulePreview,
  AnalysisScheduleState,
} from "@/lib/analysis-schedule-types";
import { parseCollectionFiles } from "@/lib/file-processing";
import {
  automateAnalysisCatalogProvisioning,
  listAnalysisClientRules,
  listAnalysisNotionProvisioningRequests,
  listAnalysisScheduleMonths,
  loadAnalysisNotionSettings,
  loadAnalysisScheduleSamples,
  loadAnalysisScheduleState,
  saveAnalysisScheduleImport,
} from "@/lib/firestore";
import type { CollectionSample, SourceFileMetadata, UserProfile } from "@/lib/types";
import { downloadPendingAnalysisPdf } from "./pending-analysis-report-export";
import { AnalysisClientRulesSettings } from "./AnalysisClientRulesSettings";

type NotionMode = "all" | "published" | "pending" | "last-import";
type GroupFilter = "all" | "published" | "pending" | "warning";

interface PreparedMonth {
  competence: string;
  samples: CollectionSample[];
  state: AnalysisScheduleState;
  preview: AnalysisSchedulePreview;
  alreadyImported: boolean;
}

interface AutomaticImportPreview {
  months: PreparedMonth[];
  invalidSamples: CollectionSample[];
  conflicts: AnalysisCompetenceConflict[];
  dominantCompetence: string;
}

const EMPTY_STATE: AnalysisScheduleState = { month: null, samples: [], imports: [] };
const EMPTY_NOTION_SETTINGS: AnalysisNotionSettings = {
  templateDatabaseName: "Modelo do acompanhamento de análises",
  templateDatabaseUrl: "",
  competenceDatabases: {},
  promptVersion: 1,
};

export function AnalysisScheduleFeature({ user, profile }: { user: User; profile: UserProfile }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [competence, setCompetence] = useState(currentCompetence());
  const [months, setMonths] = useState<Awaited<ReturnType<typeof listAnalysisScheduleMonths>>>([]);
  const [state, setState] = useState<AnalysisScheduleState>(EMPTY_STATE);
  const [rules, setRules] = useState<AnalysisClientRule[]>(DEFAULT_ANALYSIS_CLIENT_RULES);
  const [rulesSource, setRulesSource] = useState<"default" | "firestore">("default");
  const [showRulesSettings, setShowRulesSettings] = useState(false);
  const [catalogQueue, setCatalogQueue] = useState<AnalysisNotionProvisioningRequest[]>([]);
  const [provisioningRequests, setProvisioningRequests] = useState<AnalysisNotionProvisioningRequest[]>([]);
  const [notionSettings, setNotionSettings] = useState<AnalysisNotionSettings>(EMPTY_NOTION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileMetadata, setFileMetadata] = useState<SourceFileMetadata | null>(null);
  const [automaticPreview, setAutomaticPreview] = useState<AutomaticImportPreview | null>(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [notionMode, setNotionMode] = useState<NotionMode>("all");
  const [copied, setCopied] = useState(false);
  const [pendingCopied, setPendingCopied] = useState(false);
  const [downloadingPendingPdf, setDownloadingPendingPdf] = useState(false);

  const refreshMonths = async () => {
    const loaded = await listAnalysisScheduleMonths();
    setMonths(loaded);
    return loaded;
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError("");
      setAutomaticPreview(null);
      setSelectedFile(null);
      setFileMetadata(null);
      try {
        const [loaded, , remoteRules, requests, settings] = await Promise.all([
          loadAnalysisScheduleState(competence),
          refreshMonths(),
          listAnalysisClientRules().catch(() => []),
          listAnalysisNotionProvisioningRequests([competence]).catch(() => []),
          loadAnalysisNotionSettings().catch(() => EMPTY_NOTION_SETTINGS),
        ]);
        const mergedRules = mergeAnalysisClientRules(DEFAULT_ANALYSIS_CLIENT_RULES, remoteRules);
        let effectiveRules = mergedRules;
        let effectiveRequests = requests;
        let automatedRulesCreated = false;
        if (profile.role === "administrator") {
          const drafts = buildAnalysisNotionProvisioningDrafts(
            competence,
            groupAnalysisScheduleSamples(loaded.samples, mergedRules),
          );
          if (drafts.length) {
            const automation = await automateAnalysisCatalogProvisioning(
              drafts,
              mergedRules,
              user,
              profile,
            );
            effectiveRules = mergeAnalysisClientRules(mergedRules, automation.rules);
            effectiveRequests = mergeProvisioningRequests(requests, automation.requests);
            automatedRulesCreated = automation.rules.length > 0;
          }
        }
        if (!cancelled) {
          setState(loaded);
          setRules(effectiveRules);
          setRulesSource(remoteRules.length || automatedRulesCreated ? "firestore" : "default");
          setProvisioningRequests(effectiveRequests);
          setNotionSettings(settings);
        }
      } catch {
        if (!cancelled) setError("Não foi possível carregar a agenda desta competência.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [competence, profile, user]);

  const groups = useMemo(() => groupAnalysisScheduleSamples(state.samples, rules), [rules, state.samples]);
  const lastUploadId = state.imports.find((entry) => entry.status === "completed")?.id ?? "";
  const notionPayload = useMemo(() => generateNotionScheduleText({
    competence,
    groups,
    mode: notionMode,
    lastUploadId,
    provisioningRequests,
    notionSettings,
  }), [competence, groups, notionMode, lastUploadId, provisioningRequests, notionSettings]);
  const notionProvisioningCount = notionPayload.provisioningRequests.filter((request) =>
    !request.completedAt,
  ).length || notionPayload.creationGroups.length;
  const filteredGroups = groups.filter((group) => {
    const matchesFilter = groupFilter === "all"
      || (groupFilter === "published" && group.publicationStatus === "Publicado")
      || (groupFilter === "pending" && group.publicationStatus !== "Publicado")
      || (groupFilter === "warning" && group.warnings.length > 0);
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const matchesSearch = !term || [group.clientTitle, group.sourceCompany, group.analysisType, group.periodicity]
      .some((value) => value.toLocaleLowerCase("pt-BR").includes(term));
    return matchesFilter && matchesSearch;
  });
  const pendingReport = useMemo(() => buildPendingAnalysisReport({
    competence,
    samples: state.samples,
    generatedBy: profile.displayName,
    rules,
  }), [competence, state.samples, profile.displayName, rules]);
  const pendingWhatsAppText = useMemo(
    () => generateWhatsAppPendingText(pendingReport),
    [pendingReport],
  );

  const chooseFile = async (file: File) => {
    setProcessing(true);
    setError("");
    setNotice("");
    setAutomaticPreview(null);
    setSelectedFile(file);
    try {
      const parsed = await parseCollectionFiles([file]);
      const metadata = parsed.files[0];
      const partition = partitionSamplesByCollectionMonth(parsed.samples);
      if (!partition.months.length) throw new Error("Nenhuma amostra possui uma data de coleta válida.");

      const knownMonths = await listAnalysisScheduleMonths();
      const targetKeys = new Set(partition.months.map((item) => item.competence));
      const targetStates = await Promise.all(partition.months.map(async (item) => ({
        competence: item.competence,
        state: await loadAnalysisScheduleState(item.competence),
      })));
      const historicalSamples = await Promise.all(
        knownMonths
          .filter((month) => !targetKeys.has(month.id))
          .map(async (month) => ({ competence: month.id, samples: await loadAnalysisScheduleSamples(month.id) })),
      );
      const existingLocations = new Map<string, string>();
      for (const item of targetStates) {
        for (const sample of item.state.samples) existingLocations.set(sample.sampleKey, item.competence);
      }
      for (const item of historicalSamples) {
        for (const sample of item.samples) existingLocations.set(sample.sampleKey, item.competence);
      }

      const preparedMonths = partition.months.map((item) => {
        const targetState = targetStates.find((entry) => entry.competence === item.competence)?.state ?? EMPTY_STATE;
        return {
          competence: item.competence,
          samples: item.samples,
          state: targetState,
          preview: buildAnalysisSchedulePreview(targetState.samples, item.samples, item.competence),
          alreadyImported: targetState.imports.some((entry) =>
            entry.fileHash === metadata.sha256 && entry.status !== "failed",
          ),
        };
      });
      if (preparedMonths.every((item) => item.alreadyImported)) {
        throw new Error("Este arquivo já foi importado em todas as competências identificadas.");
      }
      setFileMetadata(metadata);
      setMonths(knownMonths);
      setAutomaticPreview({
        months: preparedMonths,
        invalidSamples: partition.invalidSamples,
        conflicts: findAnalysisCompetenceConflicts(partition, existingLocations),
        dominantCompetence: [...partition.months]
          .sort((left, right) => right.samples.length - left.samples.length)[0].competence,
      });
    } catch (cause) {
      setSelectedFile(null);
      setFileMetadata(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível ler o arquivo samples.");
    } finally {
      setProcessing(false);
    }
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void chooseFile(file);
  };

  const confirmImport = async () => {
    if (!selectedFile || !fileMetadata || !automaticPreview || automaticPreview.conflicts.length) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updatedStates = new Map<string, AnalysisScheduleState>();
      for (const item of automaticPreview.months) {
        if (item.alreadyImported) {
          updatedStates.set(item.competence, item.state);
          continue;
        }
        const updated = await saveAnalysisScheduleImport({
          competence: item.competence,
          file: fileMetadata,
          samples: item.samples,
          preview: item.preview,
        }, user, profile);
        updatedStates.set(item.competence, updated);
      }
      await refreshMonths();
      const provisioningDrafts = [...updatedStates.entries()].flatMap(([monthCompetence, updatedState]) =>
        buildAnalysisNotionProvisioningDrafts(
          monthCompetence,
          groupAnalysisScheduleSamples(updatedState.samples, rules),
        ),
      );
      const catalogAutomation = await automateAnalysisCatalogProvisioning(
        provisioningDrafts,
        rules,
        user,
        profile,
      );
      const savedProvisioning = catalogAutomation.requests;
      const inserted = automaticPreview.months.reduce((sum, item) => sum + (item.alreadyImported ? 0 : item.preview.inserted.length), 0);
      const updated = automaticPreview.months.reduce((sum, item) => sum + (item.alreadyImported ? 0 : item.preview.updated.length), 0);
      const savedMonths = automaticPreview.months.filter((item) => !item.alreadyImported).length;
      const destination = automaticPreview.dominantCompetence;
      setState(updatedStates.get(destination) ?? EMPTY_STATE);
      setCompetence(destination);
      setRules((current) => mergeAnalysisClientRules(current, catalogAutomation.rules));
      if (catalogAutomation.rules.length) setRulesSource("firestore");
      setProvisioningRequests((current) => mergeProvisioningRequests(
        current,
        savedProvisioning.filter((request) => request.competence === destination),
      ));
      const automatedCount = catalogAutomation.rules.length;
      const failedCount = catalogAutomation.failures.length;
      const provisioningNotice = automatedCount
        ? ` ${automatedCount} novo(s) cliente(s) foram cadastrados e vinculados automaticamente.`
        : "";
      const exceptionNotice = failedCount
        ? ` ${failedCount} exceção(ões) precisam de revisão.`
        : "";
      setNotice(`Arquivo distribuído automaticamente em ${savedMonths} competência(s): ${inserted} novas e ${updated} alteradas.${provisioningNotice}${exceptionNotice}`);
      setSelectedFile(null);
      setFileMetadata(null);
      setAutomaticPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar esta atualização.");
    } finally {
      setSaving(false);
    }
  };

  const copyNotion = async () => {
    try {
      await navigator.clipboard.writeText(notionPayload.text);
      setCopied(true);
      setNotice("Instrução copiada. Cole o texto na IA do Notion.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.");
    }
  };

  const saveRuleLocally = (saved: AnalysisClientRule) => {
    setRules((current) => [...current.filter((rule) => rule.id !== saved.id), saved]
      .sort((left, right) => left.title.localeCompare(right.title, "pt-BR")));
    setRulesSource("firestore");
  };

  const updateProvisioningLocally = (saved: AnalysisNotionProvisioningRequest) => {
    setProvisioningRequests((current) => mergeProvisioningRequests(current, [saved]));
    setCatalogQueue((current) => mergeProvisioningRequests(current, [saved]));
  };

  const openCatalog = async () => {
    setError("");
    let queue = provisioningRequests.filter((request) =>
      request.catalogStatus !== "linked"
        || [request.currentTarget.status, request.templateTarget.status]
          .some((status) => status === "blocked" || status === "failed"),
    );
    setCatalogQueue(queue);
    setShowRulesSettings(true);

    const drafts = buildAnalysisNotionProvisioningDrafts(competence, groups);
    if (drafts.length) {
      try {
        const automation = await automateAnalysisCatalogProvisioning(drafts, rules, user, profile);
        setRules((current) => mergeAnalysisClientRules(current, automation.rules));
        if (automation.rules.length) setRulesSource("firestore");
        setProvisioningRequests((current) => mergeProvisioningRequests(current, automation.requests));
        queue = mergeProvisioningRequests(queue, automation.requests)
          .filter((request) => request.catalogStatus !== "linked"
            || [request.currentTarget.status, request.templateTarget.status]
              .some((status) => status === "blocked" || status === "failed"));
      } catch {
        // O catálogo continua disponível mesmo se a sincronização da fila falhar.
        return;
      }
    }
    setCatalogQueue(queue);
  };

  const closeCatalog = () => {
    setShowRulesSettings(false);
    setCatalogQueue([]);
  };

  const copyPendingWhatsApp = async () => {
    try {
      await navigator.clipboard.writeText(pendingWhatsAppText);
      setPendingCopied(true);
      window.setTimeout(() => setPendingCopied(false), 1800);
    } catch {
      setError("Não foi possível copiar o texto para WhatsApp.");
    }
  };

  const downloadPendingTxt = () => {
    downloadTextFile(`analises-pendentes-${competence}.txt`, pendingWhatsAppText);
  };

  const downloadPendingPdfFile = async () => {
    setDownloadingPendingPdf(true);
    setError("");
    try {
      await downloadPendingAnalysisPdf(pendingReport);
    } catch {
      setError("Não foi possível gerar o PDF de pendências.");
    } finally {
      setDownloadingPendingPdf(false);
    }
  };

  if (showRulesSettings) {
    return <AnalysisClientRulesSettings
      user={user}
      profile={profile}
      rules={rules}
      competence={competence}
      requests={catalogQueue}
      exceptionGroups={groups.filter((group) =>
        group.resolutionStatus === "suggested" || group.resolutionStatus === "ambiguous"
      )}
      notionSettings={notionSettings}
      onClose={closeCatalog}
      onSaved={saveRuleLocally}
      onRequestUpdated={updateProvisioningLocally}
      onSettingsSaved={setNotionSettings}
    />;
  }

  return (
    <div className="page-stack analysis-schedule-page">
      <section className="analysis-schedule-intro">
        <div>
          <span className="section-kicker">AGENDA MENSAL</span>
          <h2>{analysisScheduleMonthLabel(competence)}</h2>
          <p>Envie novas exportações do samples. A competência de cada amostra é definida automaticamente pelo mês da data de coleta.</p>
        </div>
        <div className="schedule-intro-actions">
          {profile.role === "administrator" && <button className="button light compact-button" type="button" onClick={() => void openCatalog()}><Settings2 size={16} /> Configurações</button>}
          <MonthPicker
            value={competence}
            availableCompetences={months.map((month) => month.sortKey)}
            onChange={setCompetence}
          />
        </div>
      </section>

      {error && <div className="alert error-alert"><XCircle size={18} /><span>{error}</span></div>}
      {notice && <div className="alert success-alert"><CheckCircle2 size={18} /><span>{notice}</span></div>}

      <section className="metric-grid analysis-schedule-metrics">
        <ScheduleMetric icon={<FileSpreadsheet />} tone="teal" label="Amostras únicas" value={state.month?.sampleCount ?? state.samples.length} detail="consolidadas na competência" />
        <ScheduleMetric icon={<CheckCircle2 />} tone="green" label="Publicadas" value={state.month?.publishedCount ?? state.samples.filter((sample) => sample.publicationDate).length} detail="com data de publicação" />
        <ScheduleMetric icon={<Clock3 />} tone="amber" label="Pendentes" value={state.month?.pendingCount ?? state.samples.filter((sample) => !sample.publicationDate).length} detail="recebidas ou em análise" />
        <ScheduleMetric icon={<History />} tone="blue" label="Atualizações" value={state.imports.filter((entry) => entry.status === "completed").length} detail={state.month?.lastImportByName ? `última por ${state.month.lastImportByName}` : "nenhuma importação"} />
      </section>

      <section className="content-card schedule-upload-card">
        <div className="card-heading">
          <div><span className="section-kicker">COMPETÊNCIA AUTOMÁTICA PELA COLETA</span><h2>Importar arquivo samples</h2><p>O arquivo é consolidado por número-base e separado por mês usando somente a data de coleta.</p></div>
          <button className="button secondary" type="button" disabled={processing || saving} onClick={() => fileInput.current?.click()}>
            {processing ? <LoaderCircle className="spin" size={18} /> : <UploadCloud size={18} />} Selecionar samples
          </button>
          <input ref={fileInput} hidden type="file" accept=".xlsx,.xls" onChange={onFileInput} />
        </div>

        {automaticPreview && selectedFile && (
          <div className="schedule-preview">
            <div className="selected-file">
              <span className="file-type excel"><FileSpreadsheet size={17} /></span>
              <span><strong>{selectedFile.name}</strong><small>{formatBytes(selectedFile.size)}</small></span>
            </div>
            <div className="schedule-preview-counts">
              <span><b>{automaticPreview.months.reduce((sum, item) => sum + item.preview.inserted.length, 0)}</b> novas</span>
              <span><b>{automaticPreview.months.reduce((sum, item) => sum + item.preview.updated.length, 0)}</b> atualizadas</span>
              <span><b>{automaticPreview.months.reduce((sum, item) => sum + item.preview.unchanged.length, 0)}</b> sem alteração</span>
              <span className={automaticPreview.invalidSamples.length ? "warning" : ""}><b>{automaticPreview.invalidSamples.length}</b> sem coleta válida</span>
            </div>
            <div className="schedule-auto-month-list">
              {automaticPreview.months.map((item) => (
                <article className="schedule-auto-month-row" key={item.competence}>
                  <div><strong>{analysisScheduleMonthLabel(item.competence)}</strong><small>{item.samples.length} amostras pela data de coleta</small></div>
                  <span>{item.alreadyImported ? "Arquivo já importado" : `${item.preview.inserted.length} novas · ${item.preview.updated.length} atualizadas · ${item.preview.unchanged.length} iguais`}</span>
                </article>
              ))}
            </div>
            {automaticPreview.invalidSamples.length > 0 && (
              <div className="alert schedule-competence-warning"><AlertTriangle size={17} /><span>{automaticPreview.invalidSamples.length} amostra(s) serão ignoradas porque não possuem data de coleta válida: {automaticPreview.invalidSamples.slice(0, 8).map((sample) => sample.sampleNumber).join(", ")}{automaticPreview.invalidSamples.length > 8 ? "…" : ""}.</span></div>
            )}
            {automaticPreview.conflicts.length > 0 && (
              <div className="alert error-alert"><XCircle size={17} /><span>Há {automaticPreview.conflicts.length} conflito(s) de competência. Corrija a data de coleta antes de importar: {automaticPreview.conflicts.slice(0, 6).map((item) => `${item.sampleNumber} (${analysisScheduleMonthLabel(item.existingCompetence)} → ${analysisScheduleMonthLabel(item.detectedCompetence)})`).join(", ")}{automaticPreview.conflicts.length > 6 ? "…" : ""}.</span></div>
            )}
            <div className="schedule-preview-actions">
              <button className="button ghost" type="button" onClick={() => { setAutomaticPreview(null); setSelectedFile(null); setFileMetadata(null); }}>Cancelar</button>
              <button className="button primary" type="button" disabled={saving || automaticPreview.conflicts.length > 0} onClick={() => void confirmImport()}>
                {saving ? <><LoaderCircle className="spin" size={18} /> Salvando...</> : <><RefreshCw size={18} /> Atualizar competências</>}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="content-card schedule-results-card">
        <div className="card-heading result-card-heading">
          <div><span className="section-kicker">ESTADO CONSOLIDADO</span><h2>Clientes, tipos e periodicidades</h2><p>{groups.length} agrupamentos formados a partir de {state.samples.length} amostras.</p></div>
          <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente ou tipo" /></label>
        </div>
        <div className="filter-tabs">
          {([
            ["all", "Todos", groups.length],
            ["published", "Publicados", groups.filter((group) => group.publicationStatus === "Publicado").length],
            ["pending", "Pendentes", groups.filter((group) => group.publicationStatus !== "Publicado").length],
            ["warning", "Revisar", groups.filter((group) => group.warnings.length).length],
          ] as const).map(([id, label, count]) => (
            <button key={id} className={groupFilter === id ? "active" : ""} type="button" onClick={() => setGroupFilter(id)}>{label}<b>{count}</b></button>
          ))}
        </div>
        {loading ? <div className="table-loading"><LoaderCircle className="spin" size={20} /> Carregando agenda...</div> : filteredGroups.length ? (
          <div className="table-wrap">
            <table className="data-table schedule-table">
              <thead><tr><th>Cliente</th><th>Correspondência</th><th>Tipo</th><th>Periodicidade</th><th>Coleta</th><th>Liberação</th><th>Situação</th><th>Amostras</th></tr></thead>
              <tbody>{filteredGroups.map((group) => (
                <tr key={group.id}>
                  <td><strong>{group.clientTitle}</strong><small>{group.warnings.join(" ") || group.sourceCompany}{group.candidateTitles.length && !group.safeForNotion ? ` Candidatos: ${group.candidateTitles.join(", ")}.` : ""}</small></td>
                  <td><span className={`analysis-match-badge ${group.resolutionStatus}`}>{matchStatusLabel(group.resolutionStatus)}</span></td>
                  <td>{group.analysisType}</td><td>{group.periodicity}</td>
                  <td>{group.collectionDates.join(", ") || "—"}</td>
                  <td>{group.publicationDate || "—"}</td>
                  <td><span className={`schedule-status ${statusClass(group.publicationStatus)}`}>{group.publicationStatus}</span></td>
                  <td>{group.sampleNumbers.length}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="schedule-empty"><CalendarDays size={26} /><strong>Nenhum agrupamento encontrado</strong><span>{state.samples.length ? "Altere os filtros de busca." : "Importe um arquivo samples para iniciar esta competência."}</span></div>}
      </section>

      <section className="content-card schedule-pending-card">
        <div className="card-heading result-card-heading">
          <div>
            <span className="section-kicker">COBRANÇA AO LABORATÓRIO</span>
            <h2>Análises pendentes</h2>
            <p>{pendingReport.total} amostras ainda não possuem laudo publicado nesta competência.</p>
          </div>
          <div className="schedule-pending-actions">
            <button className="button ghost compact-button" type="button" disabled={!pendingReport.total} onClick={() => void copyPendingWhatsApp()}><MessageCircle size={16} /> {pendingCopied ? "Copiado" : "Copiar WPP"}</button>
            <button className="button secondary compact-button" type="button" disabled={!pendingReport.total} onClick={downloadPendingTxt}><FileDown size={16} /> Baixar TXT</button>
            <button className="button primary compact-button" type="button" disabled={!pendingReport.total || downloadingPendingPdf} onClick={() => void downloadPendingPdfFile()}>
              {downloadingPendingPdf ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Baixar PDF
            </button>
          </div>
        </div>
        {pendingReport.rows.length ? (
          <div className="table-wrap">
            <table className="data-table schedule-pending-table">
              <thead><tr><th>Nº da amostra</th><th>Cliente</th><th>Data de coleta</th><th>Identificação</th><th>Situação</th></tr></thead>
              <tbody>{pendingReport.rows.map((row) => (
                <tr key={row.sampleNumber}>
                  <td><strong>{row.sampleNumber}</strong></td>
                  <td>{row.client}</td>
                  <td>{row.collectionDate || "—"}</td>
                  <td>{row.identification}</td>
                  <td><span className="schedule-status pending">{row.situation}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="schedule-empty compact"><CheckCircle2 size={25} /><strong>Nenhuma análise pendente</strong><span>Todos os laudos desta competência já foram publicados.</span></div>}
      </section>

      <div className="schedule-bottom-grid">
        <section className="content-card schedule-notion-card">
          <div className="card-heading"><div><span className="section-kicker">NOTION</span><h2>Atualização pronta</h2><p>Copie a instrução completa para colar na IA do Notion.</p></div><div className="schedule-notion-actions"><button className="button primary compact-button" type="button" disabled={!notionPayload.includedGroups.length && !notionPayload.creationGroups.length && !notionPayload.provisioningRequests.length} onClick={() => void copyNotion()}><ClipboardCopy size={16} /> {copied ? "Copiado" : "Copiar"}</button></div></div>
          <div className="filter-tabs schedule-notion-filters">
            {([[
              "all", "Tudo",
            ], ["published", "Publicados"], ["pending", "Pendentes"], ["last-import", "Última importação"]] as Array<[NotionMode, string]>).map(([id, label]) => (
              <button className={notionMode === id ? "active" : ""} type="button" key={id} onClick={() => setNotionMode(id)}>{label}</button>
            ))}
          </div>
          {notionProvisioningCount > 0 && <div className="alert schedule-creation-notice"><PlusCircle size={17} /><span>{notionProvisioningCount} item(ns) novo(s) já estão cadastrados localmente e incluídos na instrução para a base atual e o modelo.</span></div>}
          {notionPayload.blockedGroups.length > 0 && <div className="alert schedule-match-warning"><AlertTriangle size={17} /><span>{notionPayload.blockedGroups.length} exceção(ões) com sugestão ou ambiguidade ficaram fora da automação.</span>{profile.role === "administrator" && <button className="button ghost compact-button" type="button" onClick={() => void openCatalog()}>Resolver exceções</button>}</div>}
          <details className="schedule-notion-details"><summary>Ver instrução gerada</summary><textarea className="schedule-notion-text" readOnly value={notionPayload.text} /></details>
        </section>

        <section className="content-card schedule-history-card">
          <div className="card-heading"><div><span className="section-kicker">HISTÓRICO</span><h2>Importações do mês</h2></div></div>
          {state.imports.length ? <div className="schedule-import-list">{state.imports.map((entry) => (
            <article key={entry.id}>
              <span className={`schedule-import-icon ${entry.status}`}><FileSpreadsheet size={16} /></span>
              <div><strong>{entry.fileName}</strong><small>{formatDateTime(entry.importedAt)} · {entry.importedByName}</small><span>{entry.insertedSamples} novas · {entry.updatedSamples} atualizadas · {entry.unchangedSamples} iguais</span></div>
            </article>
          ))}</div> : <div className="schedule-empty compact"><History size={24} /><strong>Nenhuma importação</strong><span>As atualizações desta competência aparecerão aqui.</span></div>}
        </section>
      </div>

      {months.length > 0 && <p className="schedule-month-footnote">Competências disponíveis: {months.map((month) => month.label).join(" · ")} · catálogo: {rulesSource === "firestore" ? "administrado" : "padrão do sistema"}</p>}
    </div>
  );
}

function ScheduleMetric({ icon, tone, label, value, detail }: { icon: React.ReactNode; tone: string; label: string; value: number; detail: string }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

function MonthPicker({
  value,
  availableCompetences,
  onChange,
}: {
  value: string;
  availableCompetences: string[];
  onChange: (value: string) => void;
}) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedYear = Number(value.slice(0, 4)) || new Date().getFullYear();
  const selectedMonth = Number(value.slice(5, 7)) - 1;
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(selectedYear);
  const available = useMemo(() => new Set(availableCompetences), [availableCompetences]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectMonth = (monthIndex: number) => {
    onChange(`${visibleYear}-${String(monthIndex + 1).padStart(2, "0")}`);
    setOpen(false);
  };

  const selectCurrentMonth = () => {
    const current = currentCompetence();
    onChange(current);
    setVisibleYear(Number(current.slice(0, 4)));
    setOpen(false);
  };

  return (
    <div className="schedule-month-field" ref={pickerRef}>
      <span id="schedule-month-label">Histórico exibido</span>
      <button
        className="schedule-month-trigger"
        type="button"
        aria-labelledby="schedule-month-label schedule-month-value"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setVisibleYear(selectedYear);
          setOpen((current) => !current);
        }}
      >
        <span id="schedule-month-value">{analysisScheduleMonthLabel(value)}</span>
        <CalendarDays size={17} aria-hidden="true" />
      </button>

      {open && (
        <div className="schedule-month-popover" role="dialog" aria-label="Selecionar competência">
          <div className="schedule-month-popover-heading">
            <div>
              <span>Selecionar competência</span>
              <strong>{visibleYear}</strong>
            </div>
            <div className="schedule-year-actions">
              <button type="button" aria-label="Ano anterior" onClick={() => setVisibleYear((year) => year - 1)}><ChevronLeft size={17} /></button>
              <button type="button" aria-label="Próximo ano" onClick={() => setVisibleYear((year) => year + 1)}><ChevronRight size={17} /></button>
            </div>
          </div>

          <div className="schedule-month-grid" role="group" aria-label={`Meses de ${visibleYear}`}>
            {MONTH_NAMES.map((monthName, monthIndex) => {
              const monthValue = `${visibleYear}-${String(monthIndex + 1).padStart(2, "0")}`;
              const isSelected = visibleYear === selectedYear && monthIndex === selectedMonth;
              const hasData = available.has(monthValue);
              return (
                <button
                  className={isSelected ? "selected" : ""}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${monthName} de ${visibleYear}${hasData ? ", com dados importados" : ""}`}
                  key={monthName}
                  onClick={() => selectMonth(monthIndex)}
                >
                  <span>{monthName.slice(0, 3)}</span>
                  {hasData && <i aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div className="schedule-month-popover-footer">
            <span><i aria-hidden="true" /> com dados</span>
            <button type="button" onClick={selectCurrentMonth}>Ir para este mês</button>
          </div>
        </div>
      )}
    </div>
  );
}

function mergeProvisioningRequests(
  current: AnalysisNotionProvisioningRequest[],
  incoming: AnalysisNotionProvisioningRequest[],
): AnalysisNotionProvisioningRequest[] {
  const merged = new Map(current.map((request) => [request.id, request]));
  for (const request of incoming) merged.set(request.id, request);
  return [...merged.values()].sort((left, right) =>
    left.competence.localeCompare(right.competence)
    || left.proposedTitle.localeCompare(right.proposedTitle, "pt-BR"),
  );
}

function currentCompetence(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function statusClass(value: string): string {
  if (value === "Publicado") return "published";
  if (value === "Parcialmente publicado") return "partial";
  return "pending";
}

function matchStatusLabel(value: string): string {
  if (value === "matched") return "Confirmada";
  if (value === "suggested") return "Sugestão";
  if (value === "ambiguous") return "Ambígua";
  return "Não cadastrada";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Processando";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
