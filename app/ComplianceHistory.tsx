"use client";

import {
  Building2,
  CalendarDays,
  Check,
  FileDown,
  FileClock,
  LoaderCircle,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import {
  buildIndividualReportOrientations,
  COMPLIANCE_GUIDANCE_MAX_LENGTH,
  resolveIndividualReportOrientations,
} from "@/lib/compliance-guidance";
import {
  listComplianceClients,
  listComplianceGuidance,
  listComplianceHistoryEntries,
  listComplianceMonths,
  loadMonthlyExecutiveReport,
  saveMonthlyExecutiveReport,
  saveIndividualReportSettings,
} from "@/lib/firestore";
import { buildMonthlyExecutiveReport } from "@/lib/monthly-compliance-report";
import {
  formatIndividualEmailReport,
  formatIndividualWhatsAppReport,
  formatMonthlyEmailReport,
  formatMonthlyWhatsAppReport,
} from "@/lib/compliance-report-formats";
import type {
  ComplianceGeneratedReport,
  ComplianceGuidance,
  ComplianceHistoryClient,
  ComplianceHistoryEntry,
  ComplianceHistoryMonth,
  IndividualReportOrientationMap,
  MonthlyExecutiveReport,
} from "@/lib/compliance-types";
import type { UserProfile } from "@/lib/types";
import { downloadMonthlyPdf } from "./monthly-report-export";

export function ComplianceHistory({ onNew, user, profile }: { onNew: () => void; user: User; profile: UserProfile }) {
  const [months, setMonths] = useState<ComplianceHistoryMonth[]>([]);
  const [monthId, setMonthId] = useState("");
  const [clients, setClients] = useState<ComplianceHistoryClient[]>([]);
  const [clientId, setClientId] = useState("");
  const [entries, setEntries] = useState<ComplianceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [monthlyReport, setMonthlyReport] = useState<MonthlyExecutiveReport | null>(null);
  const [generatingMonthly, setGeneratingMonthly] = useState(false);
  const [monthlyCopied, setMonthlyCopied] = useState<"whatsapp" | "email" | null>(null);
  const [guidanceCatalog, setGuidanceCatalog] = useState<ComplianceGuidance[]>([]);
  const [orientationByRunId, setOrientationByRunId] = useState<Record<string, IndividualReportOrientationMap>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listComplianceMonths(), listComplianceGuidance().catch(() => [])])
      .then(([result, guidance]) => {
        if (cancelled) return;
        setMonths(result);
        setGuidanceCatalog(guidance);
        setMonthId(result[0]?.id ?? "");
        setError("");
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar os meses do histórico.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!monthId) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (!cancelled) setLoadingEntries(true);
        return listComplianceClients(monthId);
      })
      .then((result) => {
        if (cancelled) return;
        setClients(result);
        setClientId(result[0]?.id ?? "");
        setEntries([]);
        setError("");
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar os clientes deste mês.");
      })
      .finally(() => {
        if (!cancelled) setLoadingEntries(false);
      });
    return () => { cancelled = true; };
  }, [monthId]);

  useEffect(() => {
    if (!monthId) return;
    let cancelled = false;
    void loadMonthlyExecutiveReport(monthId)
      .then((report) => {
        if (!cancelled) setMonthlyReport(report);
      })
      .catch(() => {
        if (!cancelled) setMonthlyReport(null);
      });
    return () => { cancelled = true; };
  }, [monthId]);

  useEffect(() => {
    if (!monthId || !clientId) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (!cancelled) setLoadingEntries(true);
        return listComplianceHistoryEntries(monthId, clientId);
      })
      .then((result) => {
        if (!cancelled) {
          setEntries(result);
          setOrientationByRunId(Object.fromEntries(result.map((entry) => [
            entry.runId,
            resolveIndividualReportOrientations(
              entry.report,
              guidanceCatalog,
              entry.individualReportSettings,
            ),
          ])));
          setError("");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar as análises deste cliente.");
      })
      .finally(() => {
        if (!cancelled) setLoadingEntries(false);
      });
    return () => { cancelled = true; };
  }, [monthId, clientId, guidanceCatalog]);

  const copyReport = async (entry: ComplianceHistoryEntry, channel: "whatsapp" | "email") => {
    if (!entry.report) return;
    const orientationBySectionId = orientationByRunId[entry.runId]
      ?? resolveIndividualReportOrientations(entry.report, guidanceCatalog, entry.individualReportSettings);
    const context = {
      identity: entry.identity,
      periodLabel: entry.periodLabel,
      report: entry.report,
      orientationBySectionId,
    };
    const text = channel === "whatsapp"
      ? formatIndividualWhatsAppReport(context)
      : formatIndividualEmailReport(context);
    let settingsSaved = true;
    try {
      await saveIndividualReportSettings(
        entry.runId,
        buildIndividualReportOrientations(entry.report, orientationBySectionId),
        user,
        profile,
      );
    } catch {
      settingsSaved = false;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(`${entry.id}:${channel}`);
      setError(settingsSaved ? "" : "O texto foi copiado, mas não foi possível salvar as orientações no histórico.");
      window.setTimeout(() => setCopiedId(""), 1800);
    } catch {
      setError("Não foi possível copiar o texto do relatório.");
    }
  };

  const copyMonthlyReport = async (channel: "whatsapp" | "email") => {
    if (!monthlyReport) return;
    const text = channel === "whatsapp"
      ? formatMonthlyWhatsAppReport(monthlyReport)
      : formatMonthlyEmailReport(monthlyReport);
    try {
      await navigator.clipboard.writeText(text);
      setMonthlyCopied(channel);
      window.setTimeout(() => setMonthlyCopied(null), 1800);
    } catch {
      setError("Não foi possível copiar o relatório mensal.");
    }
  };

  const generateMonthly = async () => {
    const selectedMonth = months.find((month) => month.id === monthId);
    if (!selectedMonth) return;
    setGeneratingMonthly(true);
    setError("");
    try {
      const grouped = await Promise.all(
        clients.map(async (client) => ({
          client,
          entries: await listComplianceHistoryEntries(monthId, client.id),
        })),
      );
      const draft = buildMonthlyExecutiveReport(monthId, selectedMonth.label, grouped);
      const saved = await saveMonthlyExecutiveReport(draft, user, profile);
      setMonthlyReport(saved);
    } catch {
      setError("Não foi possível gerar e armazenar o relatório executivo mensal.");
    } finally {
      setGeneratingMonthly(false);
    }
  };

  const selectedMonth = months.find((month) => month.id === monthId);
  const monthlyOutdated = Boolean(
    monthlyReport?.generatedAt
    && selectedMonth?.updatedAt
    && new Date(selectedMonth.updatedAt) > new Date(monthlyReport.generatedAt),
  );

  return (
    <div className="page-stack compliance-page">
      <section className="compliance-intro compliance-history-intro">
        <div>
          <span className="section-kicker">HISTÓRICO DE CONFORMIDADE</span>
          <h2>Análises organizadas por mês e cliente</h2>
          <p>Cada execução preserva os arquivos, o resumo, o responsável e o relatório textual gerado.</p>
        </div>
        <button className="button light" type="button" onClick={onNew}><Plus size={18} /> Nova análise</button>
      </section>

      {error && <div className="alert error-alert"><ShieldAlert size={18} /><span>{error}</span></div>}

      {loading ? (
        <div className="content-card table-loading"><LoaderCircle className="spin" /> Carregando histórico...</div>
      ) : !months.length ? (
        <section className="content-card empty-state">
          <span><FileClock /></span><h3>Nenhuma análise armazenada</h3>
          <p>As próximas análises aparecerão aqui, separadas pelo mês e pelo cliente.</p>
          <button className="button primary" type="button" onClick={onNew}>Fazer primeira análise</button>
        </section>
      ) : (
        <section className="content-card compliance-history-card">
          <div className="history-month-tabs" aria-label="Meses do histórico">
            {months.map((month) => (
              <button type="button" className={monthId === month.id ? "active" : ""} key={month.id} onClick={() => setMonthId(month.id)}>
                <CalendarDays size={16} /><span>{month.label}</span>
              </button>
            ))}
          </div>

          <div className="monthly-report-toolbar">
            <div>
              <span className="section-kicker">RELATÓRIO EXECUTIVO DO MÊS</span>
              <strong>{monthlyReport ? `${monthlyReport.summary.nonCompliances} não conformidades consolidadas` : "Ainda não gerado"}</strong>
              <small>Somente resultados comprovadamente fora do padrão legal.</small>
            </div>
            {monthlyOutdated && <span className="monthly-outdated">Existe uma análise nova neste mês</span>}
            <button className="button primary" type="button" disabled={generatingMonthly || !clients.length} onClick={() => void generateMonthly()}>
              {generatingMonthly ? <><LoaderCircle className="spin" size={17} /> Consolidando...</> : monthlyReport ? <><RefreshCw size={17} /> Atualizar relatório</> : <><FileDown size={17} /> Gerar relatório mensal</>}
            </button>
          </div>

          {monthlyReport && (
            <MonthlyReportPanel
              report={monthlyReport}
              copied={monthlyCopied}
              onCopy={(channel) => void copyMonthlyReport(channel)}
            />
          )}

          <div className="compliance-history-layout">
            <aside className="history-client-list">
              <span className="section-kicker">CLIENTES DO MÊS</span>
              {clients.map((client) => (
                <button type="button" className={clientId === client.id ? "active" : ""} key={client.id} onClick={() => setClientId(client.id)}>
                  <span className="history-client-icon"><Building2 size={17} /></span>
                  <span><strong>{client.clientName}</strong><small>{[displayFacilityName(client.facilityName), formatCnpj(client.cnpj)].filter(Boolean).join(" • ")}</small></span>
                </button>
              ))}
              {!clients.length && <p className="muted history-empty-copy">Nenhum cliente neste mês.</p>}
            </aside>

            <div className="history-analysis-list">
              <div className="history-analysis-heading">
                <div><span className="section-kicker">ANÁLISES</span><h2>{clients.find((client) => client.id === clientId)?.clientName ?? "Selecione um cliente"}</h2></div>
                <span>{entries.length} {entries.length === 1 ? "registro" : "registros"}</span>
              </div>
              {loadingEntries ? (
                <div className="table-loading"><LoaderCircle className="spin" /> Carregando análises...</div>
              ) : entries.length ? entries.map((entry) => (
                <article className="history-analysis-card" key={entry.id}>
                  <header>
                    <div><strong>{analysisTitle(entry)}</strong><small>{formatDateTime(entry.createdAt)} • {entry.createdByName}</small></div>
                    <div className="history-analysis-stats">
                      <span className={entry.summary.nonCompliant ? "danger" : "success"}>{entry.summary.nonCompliant} fora do padrão</span>
                      <span>{entry.summary.samples} amostras</span>
                    </div>
                  </header>
                  {entry.points.length > 0 && (
                    <section className="history-analysis-points">
                      <span className="section-kicker">PONTOS ANALISADOS</span>
                      <div>
                        {entry.points.map((point) => (
                          <article className={`history-point-card ${point.status}`} key={point.key} title={point.sampleNumbers.join(", ")}>
                            <span className="history-point-status">{pointStatusLabel(point.status)}</span>
                            <strong>{point.label}</strong>
                            <small>{point.samples} {point.samples === 1 ? "amostra" : "amostras"} • {point.parameters} {point.parameters === 1 ? "resultado" : "resultados"}</small>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}
                  {entry.summary.nonCompliant > 0 && entry.report && (
                    <ReportPreview
                      report={entry.report}
                      orientationBySectionId={orientationByRunId[entry.runId] ?? {}}
                      onOrientationChange={(sectionId, value) => setOrientationByRunId((current) => ({
                        ...current,
                        [entry.runId]: {
                          ...(current[entry.runId] ?? {}),
                          [sectionId]: value,
                        },
                      }))}
                    />
                  )}
                  <footer>
                    <span>{entry.files.length} arquivos • período {entry.periodLabel}</span>
                    {entry.summary.nonCompliant > 0 && entry.report && (
                      <div>
                        <button className="button ghost compact-button" type="button" onClick={() => void copyReport(entry, "whatsapp")}>
                          {copiedId === `${entry.id}:whatsapp` ? <><Check size={15} /> Copiado</> : <><MessageCircle size={15} /> WhatsApp</>}
                        </button>
                        <button className="button secondary compact-button" type="button" onClick={() => void copyReport(entry, "email")}>
                          {copiedId === `${entry.id}:email` ? <><Check size={15} /> Copiado</> : <><Mail size={15} /> E-mail</>}
                        </button>
                      </div>
                    )}
                  </footer>
                </article>
              )) : <div className="empty-state compact-empty"><span><FileClock /></span><h3>Nenhuma análise para este cliente</h3><p>Selecione outro cliente ou inicie uma nova análise.</p></div>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function MonthlyReportPanel({
  report,
  copied,
  onCopy,
}: {
  report: MonthlyExecutiveReport;
  copied: "whatsapp" | "email" | null;
  onCopy: (channel: "whatsapp" | "email") => void;
}) {
  return (
    <section className="monthly-executive-report">
      <header>
        <div>
          <span className="section-kicker">PRÉVIA PARA A DIRETORIA</span>
          <h2>Relatório mensal de não conformidades</h2>
          <p>{report.monthLabel} • versão gerada por {report.generatedByName}</p>
        </div>
        <div className="monthly-export-actions">
          <button className="button ghost compact-button" type="button" onClick={() => onCopy("whatsapp")}>{copied === "whatsapp" ? <><Check size={15} /> Copiado</> : <><MessageCircle size={15} /> WhatsApp</>}</button>
          <button className="button ghost compact-button" type="button" onClick={() => onCopy("email")}>{copied === "email" ? <><Check size={15} /> Copiado</> : <><Mail size={15} /> E-mail</>}</button>
          <button className="button secondary compact-button" type="button" onClick={() => void downloadMonthlyPdf(report)}><FileDown size={15} /> PDF</button>
        </div>
      </header>
      <div className="monthly-summary-grid">
        <div><strong>{report.summary.nonCompliances}</strong><span>fora do padrão</span></div>
        <div><strong>{report.summary.affectedClients}</strong><span>clientes afetados</span></div>
        <div><strong>{report.summary.affectedLocations}</strong><span>locais afetados</span></div>
        <div><strong>{report.summary.analysesReviewed}</strong><span>análises consideradas</span></div>
      </div>
      <div className="monthly-report-content">
        {!report.clients.length ? (
          <div className="monthly-no-findings"><Check size={18} /> Nenhum resultado comprovadamente fora do padrão legal foi identificado.</div>
        ) : report.clients.map((client) => (
          <section className="monthly-client-section" key={client.key}>
            <h3>{client.name}</h3>
            {client.cnpj && <small>CNPJ {formatCnpj(client.cnpj)}</small>}
            {client.locations.map((location) => (
              <section className="monthly-location-section" key={location.key}>
                <h4>{location.name}</h4>
                {location.positions.map((position) => (
                  <section className="monthly-position-section" key={position.key}>
                    <h5>{position.name}</h5>
                    {position.parameters.map((parameter) => (
                      <div className="monthly-parameter-block" key={parameter.key}>
                        <strong><span>🔴</span>{parameter.name}{parameter.occurrences.length > 1 ? ` - ${parameter.occurrences.length} ocorrências` : ""}</strong>
                        {parameter.occurrences.map((occurrence) => (
                          <dl key={occurrence.id}>
                            <div><dt>Resultado</dt><dd>{occurrence.result}</dd></div>
                            <div><dt>Limite legal</dt><dd>{occurrence.ruleDescription}</dd></div>
                            {occurrence.sampleNumber && <div><dt>Amostra</dt><dd>{occurrence.sampleNumber}</dd></div>}
                            {occurrence.collectionDate && <div><dt>Data da coleta</dt><dd>{occurrence.collectionDate}</dd></div>}
                            <div><dt>Situação</dt><dd>Fora do padrão estabelecido pela legislação.</dd></div>
                            {occurrence.laboratoryDeclaredNonCompliance && <div><dt>Observação</dt><dd>O próprio laudo declara “NÃO ATENDE”.</dd></div>}
                          </dl>
                        ))}
                      </div>
                    ))}
                  </section>
                ))}
              </section>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}

export function ReportPreview({
  report,
  orientationBySectionId = {},
  onOrientationChange,
}: {
  report: ComplianceGeneratedReport;
  orientationBySectionId?: IndividualReportOrientationMap;
  onOrientationChange?: (sectionId: string, value: string) => void;
}) {
  return (
    <div className="generated-report">
      {report.sections.map((section) => (
        <section className={`generated-report-section ${section.marker}`} key={section.id}>
          <h3><span>{section.marker === "red" ? "🔴" : section.marker === "amber" ? "🟠" : "🟢"}</span>{section.pointLabel ? <>Ponto de coleta: {section.pointLabel}</> : section.heading}</h3>
          {section.parameterName && <p>{section.parameterName}</p>}
          <p><strong>Resultado:</strong> {section.result}</p>
          {section.standardLabel && section.standardValue && <p><strong>{section.standardLabel}:</strong> {section.standardValue}</p>}
          <p><strong>Situação:</strong> {section.situation}</p>
          {onOrientationChange ? (
            <label className="report-orientation-field">
              <span>Orientação para este relatório <em>(opcional)</em></span>
              <textarea
                rows={2}
                maxLength={COMPLIANCE_GUIDANCE_MAX_LENGTH}
                value={orientationBySectionId[section.id] ?? ""}
                onChange={(event) => onOrientationChange(section.id, event.target.value)}
                placeholder="Digite uma orientação ou deixe em branco para omitir esta linha."
              />
              <small>Em branco, o campo “Orientação” não aparecerá no texto copiado.</small>
            </label>
          ) : orientationBySectionId[section.id]?.trim() ? (
            <p><strong>Orientação:</strong> {orientationBySectionId[section.id].trim()}</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "Data não disponível";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function analysisTitle(entry: ComplianceHistoryEntry) {
  const facility = displayFacilityName(entry.identity.facilityName);
  if (facility) return facility;
  if (entry.points.length) return `${entry.points.length} ${entry.points.length === 1 ? "ponto analisado" : "pontos analisados"}`;
  return "Análise de conformidade";
}

function displayFacilityName(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  if (!normalized || normalized === "instalacao nao identificada") return "";
  if (
    normalized.includes("saida do tratamento")
    || normalized.includes("saida do poco")
    || normalized.includes("ponto de consumo")
  ) return "";
  return value;
}

function pointStatusLabel(status: ComplianceHistoryEntry["points"][number]["status"]) {
  if (status === "non_compliant") return "Fora do padrão";
  if (status === "attention") return "Requer revisão";
  return "Sem ocorrência";
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value;
}
