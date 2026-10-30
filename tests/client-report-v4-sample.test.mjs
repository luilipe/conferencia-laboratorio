import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportDraft, resolveReportPreset } from '../lib/client-reports/presets.ts';
import { buildReportDocument } from '../lib/client-reports/document.ts';
import { renderReportHtml } from '../lib/client-reports/report-html.ts';
import { exportReportDocxV4 } from '../lib/client-reports/export-v4.ts';
import { buildClientSettingsWithDefaults } from '../lib/client-reports/default-catalog.ts';

test('DEMO13 ETDI relatório v4 gera 6 seções técnicas, HTML padronizado e Word docx sem auditoria interna', async () => {
  const demo13Settings = buildClientSettingsWithDefaults(null, 'demo13', 'user-test');
  const demo13Preset = resolveReportPreset(demo13Settings, 'demo13', 'etdi', '2', '4');
  const demo13Draft = createReportDraft('demo13', 'etdi', '2026-09');
  demo13Draft.documentRendererVersion = '4';
  demo13Draft.identity.clientDisplayName = 'DEMO13 Lubrificantes S.A.';
  demo13Draft.identity.facilityName = 'Unidade Fabril';
  demo13Draft.identity.requesterName = 'DEMO13 Lubrificantes S.A.';
  demo13Draft.identity.responsibleName = 'Equipe Técnica Ouro Fino';
  demo13Draft.identity.responsibleRegistration = 'CRQ IV';

  demo13Draft.data.lab = [
    {
      id: 'rec-1',
      labId: 'LAB-OURO',
      sampleBase: '18040-1',
      sampleNumber: '18040-1/2026.1',
      revision: 1,
      stationId: 'etdi',
      pointId: 'tratado',
      identification: 'Água tratada ETDI',
      company: 'DEMO13 Lubrificantes S.A.',
      date: '2026-09-01',
      time: null,
      publicationDate: '2026-09-05',
      parameter: 'Manganês Dissolvido',
      value: { raw: '0,06155', value: 0.06155, operator: '=', qualitative: null, unit: 'mg/L', originalUnit: 'mg/L', status: 'measured' },
      source: { sourceId: 'src-1', sheet: 'Planilha1', cell: 'U35' }
    },
    {
      id: 'rec-2',
      labId: 'LAB-OURO',
      sampleBase: '18040-1',
      sampleNumber: '18040-1/2026.1',
      revision: 1,
      stationId: 'etdi',
      pointId: 'tratado',
      identification: 'Água tratada ETDI',
      company: 'DEMO13 Lubrificantes S.A.',
      date: '2026-09-01',
      time: null,
      publicationDate: '2026-09-05',
      parameter: 'Mercúrio',
      value: { raw: '< 0,0001', value: 0.0001, operator: '<', qualitative: null, unit: 'mg/L', originalUnit: 'mg/L', status: 'measured' },
      source: { sourceId: 'src-1', sheet: 'Planilha1', cell: 'U36' }
    },
    {
      id: 'rec-3',
      labId: 'LAB-OURO',
      sampleBase: '18040-1',
      sampleNumber: '18040-1/2026.1',
      revision: 1,
      stationId: 'etdi',
      pointId: 'tratado',
      identification: 'Água tratada ETDI',
      company: 'DEMO13 Lubrificantes S.A.',
      date: '2026-09-01',
      time: null,
      publicationDate: '2026-09-05',
      parameter: 'Níquel',
      value: { raw: '< 0,001', value: 0.001, operator: '<', qualitative: null, unit: 'mg/L', originalUnit: 'mg/L', status: 'measured' },
      source: { sourceId: 'src-1', sheet: 'Planilha1', cell: 'U37' }
    },
    {
      id: 'rec-4',
      labId: 'LAB-OURO',
      sampleBase: '18040-1',
      sampleNumber: '18040-1/2026.1',
      revision: 1,
      stationId: 'etdi',
      pointId: 'tratado',
      identification: 'Água tratada ETDI',
      company: 'DEMO13 Lubrificantes S.A.',
      date: '2026-09-01',
      time: null,
      publicationDate: '2026-09-05',
      parameter: 'Prata',
      value: { raw: '< 0,001', value: 0.001, operator: '<', qualitative: null, unit: 'mg/L', originalUnit: 'mg/L', status: 'measured' },
      source: { sourceId: 'src-1', sheet: 'Planilha1', cell: 'U38' }
    }
  ];

  demo13Draft.selection.selectedLabIds = ['rec-1', 'rec-2', 'rec-3', 'rec-4'];

  const doc = buildReportDocument(demo13Draft, demo13Preset, 'draft');

  assert.equal(doc.rendererVersion, '4');
  assert.equal(doc.sections.length, 6);
  assert.equal(doc.sections[0].id, 'executive-summary');
  assert.equal(doc.sections[1].id, 'station-description');
  assert.equal(doc.sections[2].id, 'laboratory');
  assert.equal(doc.sections[3].id, 'charts');
  assert.equal(doc.sections[4].id, 'conclusion');
  assert.equal(doc.sections[5].id, 'references');

  const html = renderReportHtml(doc);
  assert.ok(html.includes('OURO FINO TECNOLOGIAS AMBIENTAIS'), 'HTML contains company brand header');
  assert.ok(html.includes('RELATÓRIO TÉCNICO DE ACOMPANHAMENTO'), 'HTML contains technical report subtitle');
  assert.ok(html.includes('DEMO13 Lubrificantes S.A.'), 'HTML contains client name');
  assert.ok(html.includes('Manganês Dissolvido'), 'HTML contains Manganese');
  assert.ok(html.includes('badge-conforme'), 'HTML contains conforme badges');
  assert.ok(!html.includes('U35'), 'HTML does not leak cell U35');
  assert.ok(!html.includes('Planilha1'), 'HTML does not leak sheet name');
  assert.ok(!html.includes('[R1]'), 'HTML does not leak matrix key');

  const blob = await exportReportDocxV4(doc);
  assert.ok(blob.size > 1000, 'Docx blob generated successfully');
});
