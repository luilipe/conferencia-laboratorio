import test from 'node:test';
import assert from 'node:assert/strict';
import { getReportPreset } from '../lib/client-reports/presets.ts';
import { buildReportDocumentV4 } from '../lib/client-reports/document-v4.ts';
import { makeDraft, lab, v, source } from './fixtures/client-report-fixtures.mjs';

test('Relatório técnico para o cliente não contém auditoria interna (SHA-256, chave matriz, célula ou nome de arquivo)', () => {
  const d = makeDraft({ presetVersion: '2', documentRendererVersion: '4', period: '2026-09' });
  d.clientId = 'demo13';
  d.stationId = 'etdi';

  d.data.sources = [{
    id: 'src-1',
    name: 'Planilha de resultados.xlsx',
    sha256: '5f96a6f2915ef0c3d3d58a51dd11ca398f6f3ee1e8c9579a890e8581bb77d46e',
    kind: 'lab',
    size: 112355,
    importedAt: '2026-10-05T08:59:00Z',
    importedByUid: 'admin',
    adapterVersion: 'test'
  }];

  // Test case requested by user: Manganês Dissolvido, Mercúrio, Níquel, Prata
  // Coleta: 01/09/2026, Água tratada, Laudo 18040-1/2026.1
  d.data.lab = [
    {
      id: 'r-mn',
      labId: 'Parceria Ouro Fino',
      sampleBase: 'sb-1',
      revision: 0,
      sampleNumber: '18040-1/2026.1',
      stationId: 'etdi',
      pointId: 'tratado',
      identification: 'ETDI - Tratado',
      company: 'Demo13',
      date: '2026-09-01',
      datePrecision: 'day',
      time: '12:40',
      publicationDate: '2026-10-01',
      parameter: 'Manganês Dissolvido',
      value: v(0.06155, 'mg/L'),
      source: { sourceId: 'src-1', sheet: 'Sheet 1', cell: 'U35' }
    },
    {
      id: 'r-hg',
      labId: 'Parceria Ouro Fino',
      sampleBase: 'sb-1',
      revision: 0,
      sampleNumber: '18040-1/2026.1',
      stationId: 'etdi',
      pointId: 'tratado',
      identification: 'ETDI - Tratado',
      company: 'Demo13',
      date: '2026-09-01',
      datePrecision: 'day',
      time: '12:40',
      publicationDate: '2026-10-01',
      parameter: 'Mercúrio',
      value: { raw: '< 0,0001', value: 0.0001, operator: '<', qualitative: null, unit: 'mg/L', originalUnit: 'mg/L', status: 'measured' },
      source: { sourceId: 'src-1', sheet: 'Sheet 1', cell: 'U36' }
    },
    {
      id: 'r-ni',
      labId: 'Parceria Ouro Fino',
      sampleBase: 'sb-1',
      revision: 0,
      sampleNumber: '18040-1/2026.1',
      stationId: 'etdi',
      pointId: 'tratado',
      identification: 'ETDI - Tratado',
      company: 'Demo13',
      date: '2026-09-01',
      datePrecision: 'day',
      time: '12:40',
      publicationDate: '2026-10-01',
      parameter: 'Níquel',
      value: { raw: '< 0,001', value: 0.001, operator: '<', qualitative: null, unit: 'mg/L', originalUnit: 'mg/L', status: 'measured' },
      source: { sourceId: 'src-1', sheet: 'Sheet 1', cell: 'U37' }
    },
    {
      id: 'r-ag',
      labId: 'Parceria Ouro Fino',
      sampleBase: 'sb-1',
      revision: 0,
      sampleNumber: '18040-1/2026.1',
      stationId: 'etdi',
      pointId: 'tratado',
      identification: 'ETDI - Tratado',
      company: 'Demo13',
      date: '2026-09-01',
      datePrecision: 'day',
      time: '12:40',
      publicationDate: '2026-10-01',
      parameter: 'Prata',
      value: { raw: '< 0,001', value: 0.001, operator: '<', qualitative: null, unit: 'mg/L', originalUnit: 'mg/L', status: 'measured' },
      source: { sourceId: 'src-1', sheet: 'Sheet 1', cell: 'U38' }
    }
  ];
  d.selection.selectedLabIds = ['r-mn', 'r-hg', 'r-ni', 'r-ag'];

  const doc = buildReportDocumentV4(d, getReportPreset('demo13', 'etdi'), 'draft');

  // Verify sections exist in professional order
  assert.equal(doc.sections[0].id, 'executive-summary');
  assert.equal(doc.sections[1].id, 'station-description');
  assert.equal(doc.sections[2].id, 'laboratory');
  assert.equal(doc.sections[3].id, 'charts');
  assert.ok(doc.sections.some(s => s.id === 'conclusion'));
  assert.ok(doc.sections.some(s => s.id === 'references'));

  // Verify laboratory section
  const labSec = doc.sections.find(s => s.id === 'laboratory');
  assert.ok(labSec);
  assert.ok(labSec.tables.length > 0);

  const t = labSec.tables[0];
  assert.match(t.title, /18040-1\/2026\.1/);
  assert.match(t.title, /01\/09\/2026/);
  assert.deepEqual(t.columns, ['Parâmetro', 'Resultado', 'Limite aplicável', 'Situação']);

  // Verify parameters and compliance situations
  const rows = t.rows;
  const mnRow = rows.find(r => r[0] === 'Manganês Dissolvido');
  const hgRow = rows.find(r => r[0] === 'Mercúrio');
  const niRow = rows.find(r => r[0] === 'Níquel');
  const agRow = rows.find(r => r[0] === 'Prata');

  assert.ok(mnRow, 'Manganês Dissolvido presente');
  assert.ok(hgRow, 'Mercúrio presente');
  assert.ok(niRow, 'Níquel presente');
  assert.ok(agRow, 'Prata presente');

  assert.equal(mnRow[3], 'Conforme');
  assert.equal(hgRow[3], 'Conforme');
  assert.equal(niRow[3], 'Conforme');
  assert.equal(agRow[3], 'Conforme');

  // Stringify all sections and tables in the document to ensure NO internal audit leak
  const docStr = JSON.stringify(doc.sections);

  // NO internal SHA-256 hashes
  assert.ok(!docStr.includes('5f96a6f2915ef0c3d3d58a51dd11ca398f6f3ee1e8c9579a890e8581bb77d46e'));
  // NO spreadsheet file names
  assert.ok(!docStr.includes('Planilha de resultados.xlsx'));
  // NO cell coordinates
  assert.ok(!docStr.includes('Sheet 1'));
  assert.ok(!docStr.includes('U35'));
  assert.ok(!docStr.includes('U36'));
  assert.ok(!docStr.includes('U37'));
  assert.ok(!docStr.includes('U38'));
  // NO internal keys
  assert.ok(!docStr.includes('[R'));
  assert.ok(!docStr.includes('Chave na matriz'));
  assert.ok(!docStr.includes('comparison-origins'));
  // NO raw '(day)'
  assert.ok(!docStr.includes('(day)'));
});
