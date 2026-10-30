"use client";

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
} from "lucide-react";
import type { User } from "firebase/auth";
import { useMemo, useState } from "react";
import {
  buildAnalysisClientRuleId,
  canonicalCompanyName,
  resolveAnalysisClientRule,
} from "@/lib/analysis-client-matching";
import type {
  AnalysisClientRule,
  AnalysisNotionProvisioningRequest,
  AnalysisNotionSettings,
  AnalysisPeriodicity,
  AnalysisScheduleGroup,
  AnalysisType,
  NotionTargetStatus,
} from "@/lib/analysis-schedule-types";
import {
  linkAnalysisNotionProvisioningRequestToRule,
  saveAnalysisClientRule,
  saveAnalysisNotionSettings,
  updateAnalysisNotionProvisioningTargets,
} from "@/lib/firestore";
import type { CollectionSample, UserProfile } from "@/lib/types";

const EMPTY_RULE: AnalysisClientRule = {
  id: "",
  title: "",
  notionUrl: "",
  aliases: [],
  companyKeys: [],
  analysisType: "Água",
  periodicity: "Mensal",
  qualifiers: {},
  active: true,
};

export function AnalysisClientRulesSettings({
  user,
  profile,
  rules,
  competence,
  requests,
  exceptionGroups,
  notionSettings,
  onClose,
  onSaved,
  onRequestUpdated,
  onSettingsSaved,
}: {
  user: User;
  profile: UserProfile;
  rules: AnalysisClientRule[];
  competence: string;
  requests: AnalysisNotionProvisioningRequest[];
  exceptionGroups: AnalysisScheduleGroup[];
  notionSettings: AnalysisNotionSettings;
  onClose: () => void;
  onSaved: (rule: AnalysisClientRule) => void;
  onRequestUpdated: (request: AnalysisNotionProvisioningRequest) => void;
  onSettingsSaved: (settings: AnalysisNotionSettings) => void;
}) {
  const initialRequest = requests.find((request) => request.catalogStatus === "pending") ?? requests[0] ?? null;
  const [activeRequestId, setActiveRequestId] = useState(initialRequest?.id ?? "");
  const activeRequest = requests.find((request) => request.id === activeRequestId) ?? null;
  const initialRuleId = initialRequest?.ruleId ?? (initialRequest ? "" : rules[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState(initialRuleId);
  const selected = rules.find((rule) => rule.id === selectedId) ?? null;
  const [draft, setDraft] = useState<AnalysisClientRule>(
    selected ?? (initialRequest ? ruleDraftFromRequest(initialRequest) : EMPTY_RULE),
  );
  const [saving, setSaving] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testCompany, setTestCompany] = useState(initialRequest?.sourceCompany ?? "Demo28 do Brasil Participações LTDA - Ouro Fino");
  const [testIdentification, setTestIdentification] = useState("Saída do Tratamento");
  const [testSampleType, setTestSampleType] = useState("Água Tratada");
  const [currentStatus, setCurrentStatus] = useState<NotionTargetStatus>(initialRequest?.currentTarget.status ?? "pending");
  const [currentUrl, setCurrentUrl] = useState(initialRequest?.currentTarget.notionUrl ?? "");
  const [templateStatus, setTemplateStatus] = useState<NotionTargetStatus>(initialRequest?.templateTarget.status ?? "pending");
  const [templateUrl, setTemplateUrl] = useState(initialRequest?.templateTarget.notionUrl ?? "");
  const [settingsDraft, setSettingsDraft] = useState<AnalysisNotionSettings>(notionSettings);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(Boolean(initialRequest));

  const simulatorRules = useMemo(() => [
    ...rules.filter((rule) => rule.id !== draft.id),
    ...(draft.title.trim() ? [draft] : []),
  ], [draft, rules]);
  const simulation = useMemo(() => resolveAnalysisClientRule(
    testSample(testCompany, testIdentification, testSampleType),
    draft.analysisType,
    draft.periodicity,
    simulatorRules,
  ), [draft.analysisType, draft.periodicity, simulatorRules, testCompany, testIdentification, testSampleType]);

  const selectRequest = (id: string) => {
    const request = requests.find((entry) => entry.id === id);
    if (!request) return;
    setActiveRequestId(id);
    setTestCompany(request.sourceCompany);
    const linkedRule = request.ruleId ? rules.find((rule) => rule.id === request.ruleId) : null;
    setSelectedId(linkedRule?.id ?? "");
    setDraft(linkedRule ?? ruleDraftFromRequest(request));
    setCurrentStatus(request.currentTarget.status);
    setCurrentUrl(request.currentTarget.notionUrl ?? "");
    setTemplateStatus(request.templateTarget.status);
    setTemplateUrl(request.templateTarget.notionUrl ?? "");
    setError("");
    setNotice("");
  };

  const selectRule = (id: string) => {
    const rule = rules.find((entry) => entry.id === id);
    setSelectedId(id);
    setDraft(rule ?? EMPTY_RULE);
    setError("");
    setNotice("");
  };

  const createRule = () => {
    setSelectedId("");
    setDraft(activeRequest ? ruleDraftFromRequest(activeRequest) : EMPTY_RULE);
    setError("");
    setNotice("");
    setRuleEditorOpen(true);
  };

  const reviewException = (group: AnalysisScheduleGroup, candidateTitle?: string) => {
    const candidate = candidateTitle
      ? rules.find((rule) => rule.title === candidateTitle)
      : null;
    setActiveRequestId("");
    setTestCompany(group.sourceCompany);
    setSelectedId(candidate?.id ?? "");
    setDraft(candidate ?? EMPTY_RULE);
    setRuleEditorOpen(true);
    setError("");
    setNotice("");
    window.setTimeout(() => document.getElementById("analysis-rule-editor")?.scrollIntoView({ behavior: "smooth" }), 0);
  };

  const confirmSuggestion = async (group: AnalysisScheduleGroup) => {
    const candidate = rules.find((rule) => rule.title === group.candidateTitles[0]);
    if (!candidate) return reviewException(group);
    setSaving(true);
    setError("");
    try {
      const saved = await saveAnalysisClientRule({
        ...candidate,
        aliases: [...new Set([...candidate.aliases, group.sourceCompany])],
        companyKeys: [...new Set([
          ...candidate.companyKeys,
          canonicalCompanyName(group.sourceCompany),
        ])],
      }, user, profile);
      onSaved(saved);
      setNotice(`Sugestão confirmada e ${saved.title} vinculado automaticamente.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar a sugestão.");
    } finally {
      setSaving(false);
    }
  };

  const update = <Key extends keyof AnalysisClientRule>(key: Key, value: AnalysisClientRule[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (profile.role !== "administrator") return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const id = draft.id || buildAnalysisClientRuleId(draft.title);
      const saved = await saveAnalysisClientRule({ ...draft, id }, user, profile);
      onSaved(saved);
      setSelectedId(saved.id);
      setDraft(saved);
      if (activeRequest) {
        const linked = await linkAnalysisNotionProvisioningRequestToRule(
          activeRequest.id,
          saved.id,
          user,
          profile,
        );
        onRequestUpdated(linked);
        const next = requests.find((request) =>
          request.id !== activeRequest.id && request.catalogStatus === "pending",
        );
        if (next) selectRequest(next.id);
      }
      setNotice(`Regra de ${saved.title} salva${activeRequest ? " e vinculada à solicitação" : ""}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a regra.");
    } finally {
      setSaving(false);
    }
  };

  const linkExisting = async () => {
    if (!activeRequest || !selected) return;
    setSaving(true);
    setError("");
    try {
      const updatedRule = await saveAnalysisClientRule({
        ...selected,
        aliases: [...new Set([...selected.aliases, activeRequest.sourceCompany])],
        companyKeys: [...new Set([
          ...selected.companyKeys,
          canonicalCompanyName(activeRequest.sourceCompany),
        ])],
      }, user, profile);
      onSaved(updatedRule);
      const linked = await linkAnalysisNotionProvisioningRequestToRule(
        activeRequest.id,
        updatedRule.id,
        user,
        profile,
      );
      onRequestUpdated(linked);
      setSelectedId(updatedRule.id);
      setDraft(updatedRule);
      setNotice(`Solicitação vinculada à regra ${updatedRule.title} e alias atualizado.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível vincular a regra.");
    } finally {
      setSaving(false);
    }
  };

  const saveTargets = async () => {
    if (!activeRequest) return;
    setSavingTargets(true);
    setError("");
    try {
      const saved = await updateAnalysisNotionProvisioningTargets(activeRequest.id, {
        currentStatus,
        currentUrl,
        templateStatus,
        templateUrl,
      }, user, profile);
      onRequestUpdated(saved);
      setNotice("Situação no Notion atualizada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a situação no Notion.");
    } finally {
      setSavingTargets(false);
    }
  };

  const saveNotionDestinations = async () => {
    setSavingSettings(true);
    setError("");
    try {
      const saved = await saveAnalysisNotionSettings(settingsDraft, user, profile);
      setSettingsDraft(saved);
      onSettingsSaved(saved);
      setNotice("Destinos do Notion salvos.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar os destinos do Notion.");
    } finally {
      setSavingSettings(false);
    }
  };

  const targetCompetence = activeRequest?.competence ?? competence;
  const currentDestination = settingsDraft.competenceDatabases[targetCompetence] ?? { name: "", url: "" };
  const updateCurrentDestination = (key: "name" | "url", value: string) => {
    setSettingsDraft((current) => ({
      ...current,
      competenceDatabases: {
        ...current.competenceDatabases,
        [targetCompetence]: { ...currentDestination, [key]: value },
      },
    }));
  };

  if (profile.role !== "administrator") {
    return <section className="content-card settings-access-denied"><ShieldCheck /><h2>Configuração restrita</h2><p>Somente administradores podem alterar o catálogo.</p></section>;
  }

  return (
    <div className="page-stack settings-page analysis-client-settings">
      <section className="settings-intro">
        <div><span className="section-kicker">ACOMPANHAMENTO DAS ANÁLISES</span><h2>Exceções e configurações</h2><p>O catálogo comum é mantido automaticamente. Use esta tela apenas para ambiguidades ou ajustes avançados.</p></div>
        <button className="button light" type="button" onClick={onClose}><ArrowLeft size={17} /> Voltar ao acompanhamento</button>
      </section>

      {error && <div className="alert error-alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {notice && <div className="alert success-alert"><CheckCircle2 size={18} /><span>{notice}</span></div>}

      {requests.length === 0 && exceptionGroups.length === 0 && <div className="alert success-alert"><CheckCircle2 size={18} /><span>Nenhuma exceção pendente. O catálogo está sendo mantido automaticamente.</span></div>}

      {exceptionGroups.length > 0 && (
        <section className="content-card settings-card analysis-exception-card">
          <div className="card-heading">
            <div><span className="section-kicker">DECISÃO HUMANA</span><h2>Correspondências ambíguas</h2><p>O sistema parou somente onde escolher sozinho poderia vincular o cliente errado.</p></div>
            <span className="settings-count">{exceptionGroups.length} exceção(ões)</span>
          </div>
          <div className="analysis-exception-list">
            {exceptionGroups.map((group) => (
              <article key={group.id}>
                <div><strong>{group.sourceCompany}</strong><span>{group.analysisType} · {group.periodicity}</span><small>{group.warnings.join(" ")}</small></div>
                {group.resolutionStatus === "suggested" && group.candidateTitles.length === 1
                  ? <button className="button primary compact-button" type="button" disabled={saving} onClick={() => void confirmSuggestion(group)}>Confirmar {group.candidateTitles[0]}</button>
                  : <div className="analysis-exception-actions">{group.candidateTitles.map((title) => <button className="button secondary compact-button" type="button" key={title} onClick={() => reviewException(group, title)}>Revisar {title}</button>)}</div>}
              </article>
            ))}
          </div>
        </section>
      )}

      {requests.length > 0 && (
        <section className="content-card settings-card analysis-provisioning-card">
          <div className="card-heading">
            <div><span className="section-kicker">INTERVENÇÃO NECESSÁRIA</span><h2>Exceções da automação</h2><p>Somente itens que não puderam ser resolvidos com segurança aparecem aqui.</p></div>
            <span className="settings-count">{requests.length} exceção(ões)</span>
          </div>
          <div className="analysis-provisioning-layout">
            <div className="analysis-provisioning-list">
              {requests.map((request) => (
                <button className={request.id === activeRequestId ? "active" : ""} type="button" key={request.id} onClick={() => selectRequest(request.id)}>
                  <strong>{request.proposedTitle}</strong>
                  <span>{request.competence} · {request.analysisType} · {request.periodicity}</span>
                  <small>{request.catalogStatus === "linked" ? "Catálogo vinculado" : "Regra pendente"} · atual: {targetStatusLabel(request.currentTarget.status)} · modelo: {targetStatusLabel(request.templateTarget.status)}</small>
                </button>
              ))}
            </div>
            {activeRequest && (
              <div className="analysis-provisioning-detail">
                <div className="analysis-provisioning-summary">
                  <strong>{activeRequest.sourceCompany}</strong>
                  <span>{activeRequest.sampleNumbers.length} amostra(s): {activeRequest.sampleNumbers.slice(0, 6).join(", ")}{activeRequest.sampleNumbers.length > 6 ? "…" : ""}</span>
                  <small>O cadastro local não conclui a inclusão no Notion. Confirme os dois destinos abaixo.</small>
                </div>
                <div className="analysis-target-grid">
                  <label className="field"><span>Base atual</span><select value={currentStatus} onChange={(event) => setCurrentStatus(event.target.value as NotionTargetStatus)}>{notionStatusOptions()}</select></label>
                  <label className="field"><span>Link do registro atual</span><input value={currentUrl} onChange={(event) => setCurrentUrl(event.target.value)} placeholder="Opcional" /></label>
                  <label className="field"><span>Modelo</span><select value={templateStatus} onChange={(event) => setTemplateStatus(event.target.value as NotionTargetStatus)}>{notionStatusOptions()}</select></label>
                  <label className="field"><span>Link do registro no modelo</span><input value={templateUrl} onChange={(event) => setTemplateUrl(event.target.value)} placeholder="Opcional" /></label>
                </div>
                <div className="guidance-settings-actions"><button className="button secondary" type="button" disabled={savingTargets} onClick={() => void saveTargets()}>{savingTargets ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Salvar situação no Notion</button></div>
              </div>
            )}
          </div>
        </section>
      )}

      <details className="content-card settings-card analysis-advanced-settings">
        <summary>Configurar destinos do Notion</summary>
        <div className="card-heading"><div><span className="section-kicker">DESTINOS DA IA DO NOTION</span><h2>Base atual e modelo</h2><p>Os nomes e links entram no texto copiado para orientar a IA.</p></div></div>
        <div className="analysis-rule-form">
          <label className="field"><span>Base atual ({targetCompetence})</span><input value={currentDestination.name} onChange={(event) => updateCurrentDestination("name", event.target.value)} placeholder={`Análises ${targetCompetence}`} /></label>
          <label className="field"><span>Link da base atual</span><input value={currentDestination.url} onChange={(event) => updateCurrentDestination("url", event.target.value)} placeholder="https://..." /></label>
          <label className="field"><span>Nome do modelo</span><input value={settingsDraft.templateDatabaseName} onChange={(event) => setSettingsDraft((current) => ({ ...current, templateDatabaseName: event.target.value }))} /></label>
          <label className="field"><span>Link do modelo</span><input value={settingsDraft.templateDatabaseUrl} onChange={(event) => setSettingsDraft((current) => ({ ...current, templateDatabaseUrl: event.target.value }))} placeholder="https://..." /></label>
        </div>
        <div className="guidance-settings-actions"><button className="button secondary" type="button" disabled={savingSettings} onClick={() => void saveNotionDestinations()}>{savingSettings ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Salvar destinos</button></div>
      </details>

      <details id="analysis-rule-editor" className="content-card settings-card analysis-advanced-settings" open={ruleEditorOpen} onToggle={(event) => setRuleEditorOpen(event.currentTarget.open)}>
        <summary>{activeRequest ? "Resolver esta exceção" : "Editar regras avançadas do catálogo"}</summary>
        <div className="card-heading">
          <div><span className="section-kicker">REGRAS ATIVAS E ALIASES</span><h2>Correspondência de empresas</h2><p>A chave é estável e não depende da página mensal do Notion.</p></div>
          <button className="button secondary compact-button" type="button" onClick={createRule}><Plus size={16} /> Nova regra</button>
        </div>
        <div className="analysis-rule-form">
          <label className="field"><span>Regra</span><select value={selectedId} onChange={(event) => selectRule(event.target.value)}><option value="">Nova regra</option>{rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.title} · {rule.periodicity}</option>)}</select></label>
          <label className="field"><span>Chave estável</span><input value={draft.id} disabled={Boolean(selected)} onChange={(event) => update("id", event.target.value)} placeholder="demo28-agua-mensal" /></label>
          <label className="field wide"><span>Título no Notion</span><input value={draft.title} onChange={(event) => update("title", event.target.value)} /></label>
          <label className="field"><span>Tipo de análise</span><select value={draft.analysisType} onChange={(event) => update("analysisType", event.target.value as AnalysisType)}><option>Água</option><option>Efluente</option><option>Polidora</option><option>Extra</option></select></label>
          <label className="field"><span>Periodicidade</span><select value={draft.periodicity} onChange={(event) => update("periodicity", event.target.value as AnalysisPeriodicity)}><option>Mensal</option><option>Semestral</option><option>Sem periodicidade</option></select></label>
          <ListField label="Nomes canônicos" value={draft.companyKeys} onChange={(value) => update("companyKeys", value)} />
          <ListField label="Aliases exatos" value={draft.aliases} onChange={(value) => update("aliases", value)} />
          <ListField label="Identificação deve conter" value={draft.qualifiers.identificationIncludes ?? []} onChange={(value) => update("qualifiers", { ...draft.qualifiers, identificationIncludes: value })} />
          <ListField label="Identificação não pode conter" value={draft.qualifiers.identificationExcludes ?? []} onChange={(value) => update("qualifiers", { ...draft.qualifiers, identificationExcludes: value })} />
          <ListField label="Tipo da amostra deve conter" value={draft.qualifiers.sampleTypeIncludes ?? []} onChange={(value) => update("qualifiers", { ...draft.qualifiers, sampleTypeIncludes: value })} />
          <label className="field wide"><span>URL atual do Notion <em>(opcional)</em></span><input value={draft.notionUrl ?? ""} onChange={(event) => update("notionUrl", event.target.value)} /></label>
          <label className="analysis-rule-checkbox"><input type="checkbox" checked={draft.active} onChange={(event) => update("active", event.target.checked)} /><span>Regra ativa</span></label>
          <div className="analysis-rule-canonical"><span>Forma canônica</span><code>{canonicalCompanyName(draft.companyKeys[0] || draft.aliases[0] || draft.title) || "—"}</code></div>
        </div>
        <div className="guidance-settings-actions">
          {activeRequest && selected && <button className="button secondary" type="button" disabled={saving} onClick={() => void linkExisting()}>Vincular regra selecionada</button>}
          <button className="button primary" type="button" disabled={saving || !draft.title.trim()} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} {activeRequest ? "Salvar e continuar" : "Salvar regra"}</button>
        </div>
      </details>

      <details className="content-card settings-card analysis-advanced-settings">
        <summary>Testar uma correspondência manualmente</summary>
        <div className="card-heading"><div><span className="section-kicker">SIMULADOR</span><h2>Testar correspondência</h2><p>O teste usa o catálogo carregado e não altera dados.</p></div><span className={`analysis-match-badge ${simulation.status}`}>{matchLabel(simulation.status)}</span></div>
        <div className="analysis-rule-form simulator">
          <label className="field wide"><span>Empresa do sample</span><input value={testCompany} onChange={(event) => setTestCompany(event.target.value)} /></label>
          <label className="field"><span>Identificação</span><input value={testIdentification} onChange={(event) => setTestIdentification(event.target.value)} /></label>
          <label className="field"><span>Tipo da amostra</span><input value={testSampleType} onChange={(event) => setTestSampleType(event.target.value)} /></label>
          <div className="analysis-simulation-result wide"><strong>{simulation.rule?.title ?? simulation.candidates[0]?.title ?? "Nenhuma regra"}</strong><span>Método: {simulation.method} · confiança: {Math.round(simulation.confidence * 100)}%</span>{simulation.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div>
        </div>
      </details>
    </div>
  );
}

function ruleDraftFromRequest(request: AnalysisNotionProvisioningRequest): AnalysisClientRule {
  return {
    id: request.proposedRuleId,
    title: request.proposedTitle,
    notionUrl: request.currentTarget.notionUrl ?? "",
    aliases: [request.sourceCompany],
    companyKeys: [canonicalCompanyName(request.sourceCompany)],
    analysisType: request.analysisType,
    periodicity: request.periodicity,
    qualifiers: {},
    active: true,
  };
}

function notionStatusOptions() {
  return (["pending", "found", "created", "blocked", "failed"] as NotionTargetStatus[])
    .map((status) => <option key={status} value={status}>{targetStatusLabel(status)}</option>);
}

function targetStatusLabel(status: NotionTargetStatus): string {
  if (status === "found") return "Localizado";
  if (status === "created") return "Criado";
  if (status === "blocked") return "Bloqueado";
  if (status === "failed") return "Falhou";
  return "Pendente";
}

function ListField({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return <label className="field"><span>{label}</span><textarea rows={3} value={value.join("\n")} onChange={(event) => onChange(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} /></label>;
}

function matchLabel(value: string): string {
  if (value === "matched") return "Confirmada";
  if (value === "suggested") return "Sugestão";
  if (value === "ambiguous") return "Ambígua";
  return "Não cadastrada";
}

function testSample(company: string, identification: string, sampleType: string): CollectionSample {
  return {
    sampleNumber: "TESTE",
    code: "",
    proposal: "",
    identification,
    sampleType,
    company,
    collectionDate: "",
    publicationDate: "",
    opinion: "",
    sampleStatus: "",
    analyses: [],
    sourceFiles: [],
    sourceRows: 1,
  };
}
