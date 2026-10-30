"use client";

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eraser,
  LoaderCircle,
  Save,
  ShieldCheck,
} from "lucide-react";
import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { COMPLIANCE_GUIDANCE_MAX_LENGTH } from "@/lib/compliance-guidance";
import { LEGAL_RULES } from "@/lib/compliance-rules";
import { listComplianceGuidance, saveComplianceGuidance } from "@/lib/firestore";
import type { ComplianceGuidance } from "@/lib/compliance-types";
import type { UserProfile } from "@/lib/types";

const PARAMETERS = [...new Map(
  LEGAL_RULES.map((rule) => [rule.parameterKey, {
    key: rule.parameterKey,
    name: rule.parameterName,
    category: rule.category,
  }]),
).values()].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

export function ComplianceSettingsFeature({
  user,
  profile,
  onBack,
}: {
  user: User;
  profile: UserProfile;
  onBack: () => void;
}) {
  const [guidance, setGuidance] = useState<ComplianceGuidance[]>([]);
  const [selectedKey, setSelectedKey] = useState(PARAMETERS[0]?.key ?? "");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedParameter = PARAMETERS.find((entry) => entry.key === selectedKey) ?? PARAMETERS[0];
  const selectedGuidance = guidance.find((entry) => entry.parameterKey === selectedKey);
  const configuredCount = guidance.filter((entry) => entry.active && entry.text.trim()).length;

  useEffect(() => {
    let cancelled = false;
    void listComplianceGuidance()
      .then((result) => {
        if (cancelled) return;
        setGuidance(result);
        setText(result.find((entry) => entry.parameterKey === PARAMETERS[0]?.key)?.text ?? "");
        setError("");
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar as orientações cadastradas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const statusLabel = useMemo(
    () => selectedGuidance?.active && selectedGuidance.text.trim()
      ? "Orientação cadastrada"
      : "Sem orientação padrão",
    [selectedGuidance],
  );

  const save = async (value: string) => {
    if (!selectedParameter || profile.role !== "administrator") return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveComplianceGuidance({
        parameterKey: selectedParameter.key,
        parameterName: selectedParameter.name,
        text: value,
      }, user, profile);
      setGuidance((current) => [
        ...current.filter((entry) => entry.parameterKey !== saved.parameterKey),
        saved,
      ]);
      setText(saved.text);
      setNotice(saved.active
        ? `Orientação de ${saved.parameterName} salva.`
        : `${saved.parameterName} ficará sem orientação padrão.`);
    } catch {
      setError("Não foi possível salvar a orientação. Verifique sua permissão e tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  if (profile.role !== "administrator") {
    return (
      <section className="content-card settings-access-denied">
        <ShieldCheck size={28} />
        <h2>Configurações restritas</h2>
        <p>Somente administradores podem alterar as orientações dos relatórios.</p>
      </section>
    );
  }

  return (
    <div className="page-stack settings-page">
      <section className="settings-intro">
        <div>
          <span className="section-kicker">AUDITORIA DAS ANÁLISES</span>
          <h2>Configurações do relatório individual</h2>
          <p>Defina as orientações sugeridas para cada parâmetro fora do padrão.</p>
        </div>
        <button className="button light" type="button" onClick={onBack}><ArrowLeft size={17} /> Voltar à auditoria</button>
      </section>

      {error && <div className="alert error-alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {notice && <div className="alert success-alert"><CheckCircle2 size={18} /><span>{notice}</span></div>}

      <section className="content-card settings-card">
        <div className="card-heading">
          <div>
            <span className="section-kicker">RELATÓRIOS ENVIADOS AO CLIENTE</span>
            <h2>Orientações por parâmetro</h2>
            <p>Cadastre uma sugestão padrão por parâmetro. O relatório mensal não utiliza estes textos.</p>
          </div>
          <span className="settings-count">{configuredCount} de {PARAMETERS.length} cadastradas</span>
        </div>

        {loading ? (
          <div className="table-loading"><LoaderCircle className="spin" /> Carregando orientações...</div>
        ) : (
          <div className="guidance-settings-form">
            <label className="field">
              <span>Parâmetro</span>
              <select value={selectedKey} onChange={(event) => {
                const nextKey = event.target.value;
                setSelectedKey(nextKey);
                setText(guidance.find((entry) => entry.parameterKey === nextKey)?.text ?? "");
                setNotice("");
              }}>
                {PARAMETERS.map((parameter) => (
                  <option value={parameter.key} key={parameter.key}>{parameter.name}</option>
                ))}
              </select>
            </label>

            <div className="guidance-selected-status">
              <span className={selectedGuidance?.active && selectedGuidance.text.trim() ? "configured" : "empty"}>{statusLabel}</span>
              <small>{selectedParameter?.category ?? "Parâmetro legal"}</small>
            </div>

            <label className="field guidance-text-field">
              <span>Orientação padrão <em>(opcional)</em></span>
              <textarea
                rows={5}
                maxLength={COMPLIANCE_GUIDANCE_MAX_LENGTH}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Ex.: Aumentar a dosagem de cloro e realizar nova medição."
              />
              <small className="guidance-field-help">
                <span>Se estiver em branco, nenhuma orientação será sugerida.</span>
                <span>{text.length}/{COMPLIANCE_GUIDANCE_MAX_LENGTH}</span>
              </small>
            </label>

            {selectedGuidance?.updatedAt && (
              <p className="guidance-updated-at">
                Última alteração em {formatDateTime(selectedGuidance.updatedAt)} por {selectedGuidance.updatedByName || selectedGuidance.updatedByEmail}.
              </p>
            )}

            <div className="guidance-settings-actions">
              <button className="button ghost" type="button" disabled={saving || !selectedGuidance?.active} onClick={() => void save("")}>
                <Eraser size={16} /> Deixar sem orientação
              </button>
              <button className="button primary" type="button" disabled={saving} onClick={() => void save(text)}>
                {saving ? <><LoaderCircle className="spin" size={16} /> Salvando...</> : <><Save size={16} /> Salvar orientação</>}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
