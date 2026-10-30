"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Info,
  LoaderCircle,
  Mail,
  MessageCircle,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import type { User } from "firebase/auth";
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { buildComplianceRun } from "@/lib/compliance";
import {
  buildIndividualReportOrientations,
  resolveIndividualReportOrientations,
} from "@/lib/compliance-guidance";
import { parseComplianceFiles } from "@/lib/compliance-pdf";
import {
  formatIndividualEmailReport,
  formatIndividualWhatsAppReport,
} from "@/lib/compliance-report-formats";
import type {
  ComplianceClassification,
  ComplianceGuidance,
  ComplianceItem,
  ComplianceRunDraft,
  IndividualReportOrientationMap,
} from "@/lib/compliance-types";
import {
  createComplianceRun,
  listComplianceGuidance,
  saveIndividualReportSettings,
} from "@/lib/firestore";
import type { UserProfile } from "@/lib/types";
import { ComplianceHistory, ReportPreview } from "./ComplianceHistory";
import { ComplianceSettingsFeature } from "./SystemSettingsFeature";

type Filter = "attention" | ComplianceClassification | "all";

const LABELS: Record<ComplianceClassification, string> = {
  non_compliant: "Fora do padrão",
  inconsistent: "Inconsistência",
  coverage_not_proven: "Cobertura não comprovada",
  no_rule: "Revisar regra",
  compliant: "Conforme",
  informational: "Informativo",
};

const FREQUENCY_LABELS: Record<ComplianceItem["frequency"], string> = {
  daily: "Diária",
  weekly: "Semanal",
  monthly: "Mensal",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
  conditional: "Condicional",
  not_defined: "Não definida",
};

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "attention", label: "Exigem atenção" },
  { id: "non_compliant", label: "Fora do padrão" },
  { id: "inconsistent", label: "Inconsistências" },
  { id: "coverage_not_proven", label: "Cobertura" },
  { id: "compliant", label: "Conformes" },
  { id: "all", label: "Todos" },
];

export function ComplianceFeature({ user, profile }: { user: User; profile: UserProfile }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [saveWarning, setSaveWarning] = useState("");
  const [run, setRun] = useState<ComplianceRunDraft | null>(null);
  const [runId, setRunId] = useState("");
  const [filter, setFilter] = useState<Filter>("attention");
  const [search, setSearch] = useState("");
  const [screen, setScreen] = useState<"analysis" | "history" | "settings">("analysis");
  const [reportCopied, setReportCopied] = useState<"whatsapp" | "email" | null>(null);
  const [guidanceCatalog, setGuidanceCatalog] = useState<ComplianceGuidance[]>([]);
  const [orientationBySectionId, setOrientationBySectionId] = useState<IndividualReportOrientationMap>({});

  useEffect(() => {
    let cancelled = false;
    void listComplianceGuidance()
      .then((result) => {
        if (!cancelled) setGuidanceCatalog(result);
      })
      .catch(() => {
        if (!cancelled) setGuidanceCatalog([]);
      });
    return () => { cancelled = true; };
  }, []);

  const addFiles = (incoming: File[]) => {
    setError("");
    setRun(null);
    setRunId("");
    setOrientationBySectionId({});
    setFiles((current) => {
      const merged = new Map(current.map((file) => [`${file.name}:${file.size}`, file]));
      for (const file of incoming) merged.set(`${file.name}:${file.size}`, file);
      return [...merged.values()];
    });
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles([...event.target.files ?? []]);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles([...event.dataTransfer.files]);
  };

  const analyze = async () => {
    if (!files.length) {
      setError("Adicione ao menos um PDF para iniciar a análise.");
      return;
    }
    setProcessing(true);
    setError("");
    setSaveWarning("");
    try {
      const parsed = await parseComplianceFiles(files);
      const draft = buildComplianceRun(parsed);
      let catalog = guidanceCatalog;
      if (!catalog.length) {
        try {
          catalog = await listComplianceGuidance();
          setGuidanceCatalog(catalog);
        } catch {
          catalog = [];
        }
      }
      setRun(draft);
      setOrientationBySectionId(resolveIndividualReportOrientations(draft.report, catalog));
      setFilter(draft.summary.attentionItems ? "attention" : "all");
      try {
        const stored = await createComplianceRun(draft, user, profile);
        setRunId(stored.id);
      } catch {
        setSaveWarning(
          "A análise foi concluída, mas não foi possível gravá-la no histórico. Os resultados abaixo continuam disponíveis para exportação.",
        );
      }
    } catch (caught) {
      setRun(null);
      setError(caught instanceof Error ? caught.message : "Não foi possível analisar os arquivos.");
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setRun(null);
    setRunId("");
    setError("");
    setSaveWarning("");
    setSearch("");
    setFilter("attention");
    setReportCopied(null);
    setOrientationBySectionId({});
  };

  if (screen === "history") {
    return <ComplianceHistory user={user} profile={profile} onNew={() => { reset(); setScreen("analysis"); }} />;
  }

  if (screen === "settings") {
    return <ComplianceSettingsFeature user={user} profile={profile} onBack={() => setScreen("analysis")} />;
  }

  if (!run) {
    return (
      <div className="page-stack compliance-page">
        <section className="compliance-intro">
          <div>
            <span className="section-kicker">CONFORMIDADE LEGAL</span>
            <h2>Analise vários laudos de um cliente de uma só vez</h2>
            <p>
              O sistema identifica cliente, instalação e pontos, reúne páginas da mesma amostra e compara os resultados com as regras vigentes cadastradas.
            </p>
          </div>
          <div className="compliance-intro-actions">
            {profile.role === "administrator" && (
              <button className="button light" type="button" onClick={() => setScreen("settings")}><Settings2 size={18} /> Configurações do relatório</button>
            )}
            <button className="button light" type="button" onClick={() => setScreen("history")}><CalendarDays size={18} /> Ver histórico</button>
          </div>
        </section>

        {error && <div className="alert error-alert"><XCircle size={18} /><span>{error}</span></div>}

        <section className="content-card compliance-upload-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">1. ARQUIVOS DO CLIENTE</span>
              <h2>Laudos e controles do Sisagua</h2>
              <p>Envie PDFs mensais ou semestrais. Use apenas um cliente por análise.</p>
            </div>
            <span className="privacy-badge"><ShieldCheck size={14} /> Validação por CNPJ e nome</span>
          </div>

          <div
            className={`compliance-dropzone ${dragging ? "dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={onDrop}
          >
            <span className="dropzone-icon"><UploadCloud /></span>
            <strong>Arraste todos os PDFs do cliente para cá</strong>
            <p>Relatórios de ensaio e Controle Mensal/Semestral de SAC</p>
            <button className="button secondary" type="button" onClick={() => inputRef.current?.click()}>
              Selecionar arquivos
            </button>
            <input ref={inputRef} hidden type="file" accept="application/pdf,.pdf" multiple onChange={onInput} />
          </div>

          {files.length > 0 && (
            <div className="compliance-files">
              <div className="compliance-files-heading">
                <strong>{files.length} {files.length === 1 ? "arquivo selecionado" : "arquivos selecionados"}</strong>
                <button type="button" className="text-button" onClick={() => setFiles([])}>Limpar lista</button>
              </div>
              <div className="compliance-file-grid">
                {files.map((file) => (
                  <div className="selected-file" key={`${file.name}:${file.size}`}>
                    <span className="file-type pdf"><FileText size={16} /></span>
                    <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Remover ${file.name}`}
                      onClick={() => setFiles((current) => current.filter((candidate) => candidate !== file))}
                    ><X size={15} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="compliance-upload-actions">
            <span><Info size={15} /> O resultado regulatório sempre deve ser validado por um responsável técnico.</span>
            <button className="button primary" type="button" disabled={!files.length || processing} onClick={() => void analyze()}>
              {processing ? <><LoaderCircle className="spin" size={18} /> Lendo e cruzando documentos...</> : <><ClipboardCheck size={18} /> Analisar conformidade</>}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const identity = run.identity;
  const copyReport = async (channel: "whatsapp" | "email") => {
    if (!run.report) return;
    const context = {
      identity,
      periodLabel: run.periodLabel,
      report: run.report,
      orientationBySectionId,
    };
    const text = channel === "whatsapp"
      ? formatIndividualWhatsAppReport(context)
      : formatIndividualEmailReport(context);
    let settingsSaved = true;
    if (runId) {
      try {
        await saveIndividualReportSettings(
          runId,
          buildIndividualReportOrientations(run.report, orientationBySectionId),
          user,
          profile,
        );
      } catch {
        settingsSaved = false;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setReportCopied(channel);
      if (!settingsSaved) {
        setSaveWarning("O texto foi copiado, mas não foi possível salvar as orientações no histórico.");
      }
      window.setTimeout(() => setReportCopied(null), 1800);
    } catch {
      setError("Não foi possível copiar o texto do relatório.");
    }
  };
  const visible = run.items.filter((item) => {
    const matchesFilter = filter === "all"
      || (filter === "attention" && item.classification !== "compliant" && item.classification !== "informational")
      || item.classification === filter;
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const matchesSearch = !term || [item.sampleNumber, item.pointLabel, item.parameterName, item.resultRaw, item.sourceFile]
      .some((value) => value.toLocaleLowerCase("pt-BR").includes(term));
    return matchesFilter && matchesSearch;
  });

  const filterCount = (id: Filter) => {
    if (id === "all") return run.items.length;
    if (id === "attention") return run.summary.attentionItems;
    return run.items.filter((item) => item.classification === id).length;
  };

  return (
    <div className="page-stack compliance-page">
      <section className="content-card compliance-identity-card">
        <div className="compliance-identity-main">
          <span className={`confidence-badge ${identity.confidence}`}><ShieldCheck size={14} /> Identificação {confidenceLabel(identity.confidence)}</span>
          <h2>{identity.clientName}</h2>
          <p>{identity.facilityName} {identity.sisaguaCode ? `• SAC ${identity.sisaguaCode}` : ""}</p>
        </div>
        <dl className="compliance-identity-details">
          <div><dt>CNPJ</dt><dd>{formatCnpj(identity.cnpj) || "Não localizado"}</dd></div>
          <div><dt>Município</dt><dd>{[identity.municipality, identity.state].filter(Boolean).join("/ ") || "Não localizado"}</dd></div>
          <div><dt>Período</dt><dd>{run.periodLabel}</dd></div>
          <div><dt>Arquivos</dt><dd>{run.summary.files}</dd></div>
        </dl>
        <div className="compliance-result-actions">
          <button className="button ghost" type="button" onClick={reset}>Nova análise</button>
          <button className="button ghost" type="button" onClick={() => setScreen("history")}><CalendarDays size={17} /> Histórico</button>
          {profile.role === "administrator" && (
            <button className="button ghost" type="button" onClick={() => setScreen("settings")}><Settings2 size={17} /> Configurações</button>
          )}
          <button className="button secondary" type="button" onClick={() => exportCsv(run)}><Download size={17} /> Exportar CSV</button>
        </div>
      </section>

      {saveWarning && <div className="alert compliance-warning"><AlertTriangle size={18} /><span>{saveWarning}</span></div>}
      {run.warnings.map((warning) => <div className="alert compliance-warning" key={warning}><AlertTriangle size={18} /><span>{warning}</span></div>)}
      {runId && <div className="compliance-saved"><CheckCircle2 size={15} /> Análise gravada com rastreabilidade.</div>}

      <section className="metric-grid compliance-metrics">
        <Metric icon={<ShieldAlert />} tone="red" label="Fora do padrão" value={run.summary.nonCompliant} helper="resultado analítico" />
        <Metric icon={<AlertTriangle />} tone="amber" label="Inconsistências" value={run.summary.inconsistent} helper="documentos conflitantes" />
        <Metric icon={<ClipboardCheck />} tone="blue" label="Cobertura não comprovada" value={run.summary.coverageNotProven} helper="frequência documental" />
        <Metric icon={<CheckCircle2 />} tone="green" label="Conformes" value={run.summary.compliant} helper={`${run.summary.samples} amostras lidas`} />
      </section>

      <div className="alert compliance-disclaimer">
        <Info size={18} />
        <span><strong>Leitura conservadora:</strong> “cobertura não comprovada” significa que os PDFs enviados não demonstram toda a frequência exigida; não afirma que o cliente deixou de monitorar.</span>
      </div>

      {run.report && (
        <section className="content-card compliance-report-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">RELATÓRIO AUTOMÁTICO</span>
              <h2>Resumo pronto para compartilhar</h2>
              <p>O texto diferencia a conclusão calculada da declaração escrita pelo laboratório.</p>
            </div>
            <div className="report-actions">
              <button className="button ghost" type="button" onClick={() => void copyReport("whatsapp")}>
                {reportCopied === "whatsapp" ? <><Check size={16} /> Copiado</> : <><MessageCircle size={16} /> Copiar WhatsApp</>}
              </button>
              <button className="button secondary" type="button" onClick={() => void copyReport("email")}>
                {reportCopied === "email" ? <><Check size={16} /> Copiado</> : <><Mail size={16} /> Copiar e-mail</>}
              </button>
            </div>
          </div>
          <ReportPreview
            report={run.report}
            orientationBySectionId={orientationBySectionId}
            onOrientationChange={(sectionId, value) => setOrientationBySectionId((current) => ({
              ...current,
              [sectionId]: value,
            }))}
          />
        </section>
      )}

      <section className="content-card results-card compliance-results">
        <div className="card-heading result-card-heading">
          <div>
            <span className="section-kicker">RESULTADO POR PONTO</span>
            <h2>Itens verificados</h2>
            <p>{run.summary.parameters} resultados únicos, com páginas repetidas da mesma amostra consolidadas.</p>
          </div>
          <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ponto ou parâmetro" /></label>
        </div>
        <div className="filter-tabs">
          {FILTERS.map((entry) => (
            <button type="button" className={filter === entry.id ? "active" : ""} key={entry.id} onClick={() => setFilter(entry.id)}>
              {entry.label}<b>{filterCount(entry.id)}</b>
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="data-table compliance-table">
            <thead><tr><th>Situação</th><th>Amostra e ponto</th><th>Parâmetro</th><th>Resultado</th><th>Regra aplicada</th><th>Origem</th></tr></thead>
            <tbody>
              {visible.map((item) => <ComplianceRow item={item} key={item.id} />)}
            </tbody>
          </table>
          {!visible.length && <div className="empty-state compact-empty"><span><Search /></span><h3>Nenhum item encontrado</h3><p>Ajuste o filtro ou o texto da busca.</p></div>}
        </div>
      </section>
    </div>
  );
}

function Metric({ icon, tone, label, value, helper }: { icon: React.ReactNode; tone: string; label: string; value: number; helper: string }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></article>;
}

function ComplianceRow({ item }: { item: ComplianceItem }) {
  return (
    <tr>
      <td><span className={`compliance-badge ${item.classification}`}><i />{LABELS[item.classification]}</span></td>
      <td><strong>{item.sampleNumber}</strong><small title={item.pointLabel}>{item.pointLabel}</small></td>
      <td><strong>{item.parameterName}</strong><small>{FREQUENCY_LABELS[item.frequency]}</small></td>
      <td><strong>{item.resultRaw}{item.unit && !item.resultRaw.includes(item.unit) ? ` ${item.unit}` : ""}</strong><small>{item.note}</small></td>
      <td>
        <strong>{item.ruleDescription}</strong>
        {item.legalSourceUrl ? <small><a href={item.legalSourceUrl} target="_blank" rel="noreferrer">{item.legalReference || "Abrir fonte oficial"}</a></small> : <small>{item.legalReference}</small>}
      </td>
      <td><strong>{item.sourceFile}</strong><small>{item.sourcePage ? `Página ${item.sourcePage}` : "Controle consolidado"}</small></td>
    </tr>
  );
}

function exportCsv(run: ComplianceRunDraft) {
  const headings = ["Situação", "Cliente", "CNPJ", "Instalação", "Amostra", "Ponto", "Parâmetro", "Resultado", "Unidade", "Frequência", "Regra", "Base legal", "Observação", "Arquivo", "Página"];
  const rows = run.items.map((item) => [
    LABELS[item.classification], run.identity.clientName, run.identity.cnpj, run.identity.facilityName,
    item.sampleNumber, item.pointLabel, item.parameterName, item.resultRaw, item.unit,
    FREQUENCY_LABELS[item.frequency], item.ruleDescription, item.legalReference, item.note,
    item.sourceFile, item.sourcePage || "",
  ]);
  const csv = `\uFEFF${[headings, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `conformidade-${safeFileName(run.identity.facilityName)}-${safeFileName(run.periodLabel)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "analise";
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function confidenceLabel(value: "high" | "medium" | "low") {
  return value === "high" ? "confirmada" : value === "medium" ? "provável" : "para revisão";
}
