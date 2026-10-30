import type { ClientReportDraft, ReportPreset, ReportDocument, ReportSection, ReportTable, ReportChart, LabResult } from './types.ts';
import { buildReportDocumentV3 } from './document-v3.ts';
import { buildNarrativeContext } from './narrative-context.ts';
import { getEditorialSectionOrder, initialReportEditorial } from './editorial.ts';
import { effectiveReportData, confirmedCampaignRemoval } from './calculations.ts';
import { validateClientReport } from './validation.ts';
import { buildReportCharts } from './charts.ts';
import { evaluateLabResultCompliance, determineSystemType } from './compliance-evaluator.ts';
import { labCollectionPeriod, labCollectionLabel } from './lab-history.ts';
import { displayReportDate, formatReportValue, normalizeParameter } from './values.ts';

const section = (id: string, title: string, paragraphs: string[] = []): ReportSection => ({
  id,
  title,
  paragraphs,
  tables: [],
  charts: [],
  orientation: 'portrait'
});

export function buildReportDocumentV4(draft: ClientReportDraft, preset: ReportPreset, mode: 'draft' | 'finalized'): ReportDocument {
  const renderDraft = structuredClone(draft);
  const data = effectiveReportData(draft);
  const lab = data.lab;

  // Filter efficiency pairs with valid campaigns
  renderDraft.selection.efficiencyPairs = draft.selection.efficiencyPairs.filter(
    pair => confirmedCampaignRemoval(lab.find(r => r.id === pair.inletId), lab.find(r => r.id === pair.outletId), pair.parameter, draft.period, draft.stationId) !== null
  );

  const content = buildReportDocumentV3(renderDraft, preset, mode);
  content.issues = validateClientReport(draft, preset);
  content.rendererVersion = '4';
  delete content.modelLayout;

  const editorial = structuredClone(draft.editorial ?? initialReportEditorial(buildNarrativeContext(draft, preset)));
  content.editorial = editorial;

  // Apply editorial model titles/paragraphs if approved
  for (const replacement of draft.editorialModel?.sections ?? []) {
    const s = content.sections.find(sec => sec.id === replacement.id);
    if (s) {
      s.title = replacement.title;
      s.paragraphs = [...replacement.paragraphs];
    }
  }

  // 1. Identify current period lab results
  const currentLab = lab.filter(r => labCollectionPeriod(r) === draft.period);
  const systemType = determineSystemType(draft.clientId, draft.stationId);

  // Evaluate compliance for all current results
  const evaluations = currentLab.map(r => evaluateLabResultCompliance(r, systemType, draft.references));

  const totalSamples = new Set(currentLab.map(r => r.sampleNumber || `${r.date}|${r.pointId}`)).size || (currentLab.length ? 1 : 0);
  const nonCompliant = evaluations.filter(e => e.situation === 'Não conforme');
  const evaluatedCount = evaluations.filter(e => e.situation !== 'Não avaliado').length;
  const conformityStatus = nonCompliant.length > 0
    ? `Não conforme (${nonCompliant.length} parâmetro(s) acima do limite)`
    : evaluatedCount > 0
      ? 'Conforme com os limites aplicáveis'
      : 'Em avaliação técnica';

  const pendingCount = content.issues.filter(i => i.severity === 'blocker' || !i.acknowledgement?.trim()).length;

  // Section 1: Resumo executivo
  const execSummary = section('executive-summary', '1. Resumo executivo', [
    `Primeira leitura executiva:`,
    `• Amostras analisadas no período: ${totalSamples}`,
    `• Situação geral de conformidade: ${conformityStatus}`,
    `• Pendências e observações técnicas: ${pendingCount}`,
    editorial.scope,
    ...editorial.summary.map(s => s.text),
    ...editorial.limitations.map(s => `Limitação: ${s}`)
  ]);
  execSummary.tables.push({
    id: 'kpi-summary',
    title: 'Primeira leitura executiva',
    columns: ['Amostras analisadas', 'Conformidade geral', 'Pendências registradas'],
    rows: [[`${totalSamples} amostra(s)`, conformityStatus, `${pendingCount} pendência(s)`]],
    sourceIds: []
  });

  // Section 2: Informações técnicas e caracterização da unidade
  const techIntro = content.sections.find(s => s.id === 'technical-introduction');
  const presentation = content.sections.find(s => s.id === 'presentation');
  const objective = content.sections.find(s => s.id === 'objective');
  const methodology = content.sections.find(s => s.id === 'methodology');
  const identity = content.sections.find(s => s.id === 'identity');

  const stationDesc = section('station-description', '2. Informações técnicas e descrição da estação', [
    ...(presentation?.paragraphs ?? []),
    ...(techIntro?.paragraphs ?? []),
    ...(objective?.paragraphs ?? []),
    ...(methodology?.paragraphs ?? [])
  ]);
  if (identity?.tables?.length) {
    stationDesc.tables = identity.tables;
  }

  // Section 3: Resultados das análises
  const periodLabel = draft.period.split('-').reverse().join('/');
  const labSection = section('laboratory', '3. Resultados das análises', [
    `Os resultados analíticos a seguir correspondem às coletas realizadas na competência ${periodLabel}, com identificação do ponto de amostragem, laudo laboratorial de referência, limites aplicáveis e situação de conformidade.`
  ]);

  if (currentLab.length === 0) {
    labSection.paragraphs.push('Sem resultados laboratoriais selecionados para esta competência.');
  } else {
    // Group results by point and sample number / date
    const groups = new Map<string, { pointId: string | null; sampleNumber: string; date: string; time: string | null; records: LabResult[] }>();
    for (const r of currentLab) {
      const key = `${r.pointId ?? 'geral'}|${r.sampleNumber || 'sem-laudo'}|${r.date}`;
      const existing = groups.get(key);
      if (existing) {
        existing.records.push(r);
      } else {
        groups.set(key, { pointId: r.pointId, sampleNumber: r.sampleNumber, date: r.date, time: r.time, records: [r] });
      }
    }

    let tableIndex = 1;
    for (const g of groups.values()) {
      const pointName = preset.points.find(p => p.id === g.pointId)?.label
        ?? (g.pointId === 'bruto' ? 'Efluente Bruto (Entrada)' : g.pointId === 'tratado' ? 'Água Tratada (Saída)' : g.pointId ?? 'Ponto de amostragem');
      const dateDisplay = g.date ? displayReportDate(g.date) : periodLabel;
      const laudoDisplay = g.sampleNumber ? `Laudo: ${g.sampleNumber}` : 'Laudo laboratorial parceiro';
      const timeDisplay = g.time ? ` às ${g.time}` : '';

      const tableTitle = `${pointName} — Coleta: ${dateDisplay}${timeDisplay} · ${laudoDisplay}`;
      const columns = ['Parâmetro', 'Resultado', 'Limite aplicável', 'Situação'];

      // Deduplicate parameters in table (preserving latest / unique)
      const seenParams = new Set<string>();
      const rows: string[][] = [];
      for (const r of g.records) {
        const norm = normalizeParameter(r.parameter);
        if (seenParams.has(norm)) continue;
        seenParams.add(norm);
        const ev = evaluateLabResultCompliance(r, systemType, draft.references);
        rows.push([r.parameter, ev.valueStr, ev.limitStr, ev.situation]);
      }

      labSection.tables.push({
        id: `lab-table-${tableIndex++}`,
        title: tableTitle,
        columns,
        rows,
        sourceIds: g.records.map(r => r.id)
      });
    }
  }

  // Section 4: Evolução dos parâmetros — gráficos
  const chartSection = section('charts', '4. Evolução dos parâmetros — gráficos', []);
  const v4Draft: ClientReportDraft = {
    ...draft,
    selection: {
      ...draft.selection,
      optionalChartIds: preset.chartDefinitions?.map(c => c.id) ?? []
    }
  };
  const allCharts: ReportChart[] = [
    ...buildReportCharts(v4Draft, preset, 'laboratory'),
    ...buildReportCharts(v4Draft, preset, 'operations'),
    ...buildReportCharts(v4Draft, preset, 'efficiency'),
    ...buildReportCharts(v4Draft, preset, 'meters')
  ];

  // Filter out completely empty charts
  const validCharts = allCharts.filter(c => c.series.some(s => s.points.some(p => p.value !== null)));

  if (validCharts.length > 0) {
    chartSection.charts = validCharts;
    chartSection.paragraphs.push('Os gráficos abaixo apresentam o comportamento dos parâmetros monitorados com base nas medições e ensaios laboratoriais reais do período.');
  } else {
    chartSection.paragraphs.push('Histórico anterior indisponível para geração de gráfico comparativo contínuo. Os resultados da competência atual constam nas tabelas técnicas deste relatório.');
  }

  // Section 5: Conclusão técnica e recomendações
  const conclusionText = draft.narratives.conclusion?.trim()
    || `Na competência ${periodLabel}, a unidade ${preset.label} foi monitorada com ${totalSamples} amostra(s) analisada(s). As análises indicam situação ${conformityStatus}. Recomenda-se a continuidade do acompanhamento operacional e cumprimento dos planos de ação.`;

  const obsText = draft.narratives.observations?.trim();
  const conclusionSection = section('conclusion', '5. Conclusão técnica e recomendações', [
    ...(obsText ? [`Observações operacionais: ${obsText}`] : []),
    conclusionText
  ]);

  if (editorial.actions.length) {
    conclusionSection.tables.push({
      id: 'actions',
      title: 'Ações e encaminhamentos técnicos',
      columns: ['Ponto de atenção / ação', 'Responsável', 'Prazo', 'Situação'],
      rows: editorial.actions.map(a => [
        a.proposal,
        a.responsible ?? 'A definir',
        a.dueDate ?? 'A definir',
        a.status === 'agreed' ? 'Acordada' : a.status === 'completed' ? 'Concluída' : 'Proposta'
      ]),
      sourceIds: []
    });
  }

  // Section 6: Referências normativas e anexos
  const refSection = section('references', '6. Referências normativas e anexos', [
    'Legislação e critérios aplicáveis:',
    '• Resolução CONAMA nº 430/2011 — Condições e padrões de lançamento de efluentes;',
    '• Decreto Estadual SP nº 8.468/1976 — Regulamento da Lei nº 997/1976 de prevenção e controle da poluição do meio ambiente;',
    '• Portaria GM/MS nº 888/2021 — Padrão de potabilidade da água para consumo humano (quando aplicável);',
    ...(draft.references.filter(r => r.approvedByUid).map(r => `• ${r.source} (${r.version}) — ${r.parameter}: ${r.application};`)),
    '',
    'Laudos laboratoriais e anexos técnicos:',
    ...Array.from(new Set(currentLab.map(r => r.sampleNumber).filter(Boolean))).map(s => `• Laudo laboratorial nº ${s};`),
    'As cópias digitalizadas dos relatórios de ensaio analíticos validados permanecem sob guarda da equipe e acompanham o presente relatório.'
  ]);

  // Operational sections if relevant (operations, meters, supplies, journal)
  const otherSections: ReportSection[] = [];
  for (const s of content.sections) {
    if (['operations', 'meters', 'supplies', 'journal'].includes(s.id)) {
      // Clean table columns so no audit IDs leak
      s.tables = s.tables.filter(t => !t.id.startsWith('chart-')).map(t => ({
        ...t,
        columns: t.columns.filter(c => !/origem|id|sha/i.test(c)),
        rows: t.rows.map(row => row.filter((_, idx) => !/origem|id|sha/i.test(t.columns[idx])))
      }));
      if (s.tables.some(t => t.rows.length > 0) || s.paragraphs.length > 0) {
        otherSections.push(s);
      }
    }
  }

  // Assemble clean document sections strictly in professional order
  const finalSections: ReportSection[] = [
    execSummary,
    stationDesc,
    labSection,
    chartSection,
    ...otherSections,
    conclusionSection,
    refSection
  ];

  // Remove any legacy audit artifacts like comparison-origins, sources or appendix-chart
  content.sections = finalSections.filter(s => !['sources', 'history', 'identity'].includes(s.id));

  // Clean all cells of any bracketed IDs [R\d+]
  for (const s of content.sections) {
    for (const t of s.tables) {
      t.rows = t.rows.map(row => row.map(cell => cell.replace(/\s*\[R\d+\]/g, '')));
    }
  }

  return content;
}
