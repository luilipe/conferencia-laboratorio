import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClientReport} from '../lib/client-reports/validation.ts';
import {createReportDraft, getReportPreset} from '../lib/client-reports/presets.ts';
import {buildReportDocument} from '../lib/client-reports/document.ts';
import {lab, source} from './fixtures/client-report-fixtures.mjs';

test('seção obrigatória ausente bloqueia com section-missing', () => {
  const d = createReportDraft('demo13', 'etdi', '2026-10');
  d.presetVersion = '2';
  d.documentRendererVersion = '3';
  d.fixedText = {
    source: { fileName: 'modelo.docx', sha256: 'a'.repeat(64) },
    sections: [{ id: 'presentation', title: 'Apresentação', paragraphs: ['Texto'] }],
    monthlySections: ['laboratory', 'supplies'],
    monthlyRequirements: { laboratory: 'required', supplies: 'conditional' }
  };
  // without laboratory results
  const preset = getReportPreset('demo13', 'etdi');
  const issues = validateClientReport(d, preset);
  assert.ok(issues.some(i => i.code === 'section-missing' && i.message.includes('laboratoriais')));
  // supplies is conditional and empty, so it does NOT generate section-missing!
  assert.ok(!issues.some(i => i.code === 'section-missing' && i.message.includes('insumos')));
});

test('seção condicional ausente omite do documento v3 sem pendência', () => {
  const d = createReportDraft('demo13', 'etdi', '2026-10');
  d.presetVersion = '2';
  d.documentRendererVersion = '3';
  d.fixedText = {
    source: { fileName: 'modelo.docx', sha256: 'a'.repeat(64) },
    sections: [{ id: 'presentation', title: 'Apresentação', paragraphs: ['Texto'] }],
    monthlySections: ['laboratory', 'supplies'],
    monthlyRequirements: { laboratory: 'required', supplies: 'conditional' }
  };
  d.data.sources = [source];
  d.data.lab = [lab({ id: 'dbo', parameter: 'DBO', date: '2026-10-15' }), lab({ id: 'dqo', parameter: 'DQO', date: '2026-10-15' })];
  d.selection.selectedLabIds = ['dbo', 'dqo'];
  const preset = getReportPreset('demo13', 'etdi');
  const issues = validateClientReport(d, preset);
  // No blocker for supplies
  assert.ok(!issues.some(i => i.code === 'section-missing'));

  const doc = buildReportDocument(d, preset, 'draft');
  assert.ok(!doc.sections.some(s => s.id === 'supplies'));
});

test('seção condicional presente com erro valida normalmente', () => {
  const d = createReportDraft('demo13', 'etdi', '2026-10');
  d.presetVersion = '2';
  d.documentRendererVersion = '3';
  d.fixedText = {
    source: { fileName: 'modelo.docx', sha256: 'a'.repeat(64) },
    sections: [{ id: 'presentation', title: 'Apresentação', paragraphs: ['Texto'] }],
    monthlySections: ['laboratory', 'supplies'],
    monthlyRequirements: { laboratory: 'required', supplies: 'conditional' }
  };
  d.data.sources = [source];
  d.data.lab = [lab({ id: 'dbo', parameter: 'DBO', date: '2026-10-15' }), lab({ id: 'dqo', parameter: 'DQO', date: '2026-10-15' })];
  d.selection.selectedLabIds = ['dbo', 'dqo'];
  // supplies present but with invalid quantity
  d.data.supplies = [{
    id: 'sup-1',
    stationId: 'etdi',
    date: '2026-10-15',
    kind: 'consumption',
    product: 'Polímero',
    quantity: { raw: 'invalido', value: null, operator: null, qualitative: null, unit: 'kg', originalUnit: 'kg', status: 'invalid' },
    source: { sourceId: source.id }
  }];
  const preset = getReportPreset('demo13', 'etdi');
  const issues = validateClientReport(d, preset);
  assert.ok(issues.some(i => i.code === 'value-unavailable'));
});

test('rascunho antigo sem monthlyRequirements mantém comportamento legado de monthlySections', () => {
  const d = createReportDraft('demo13', 'etdi', '2026-10');
  d.presetVersion = '2';
  d.documentRendererVersion = '3';
  d.fixedText = {
    source: { fileName: 'modelo.docx', sha256: 'a'.repeat(64) },
    sections: [{ id: 'presentation', title: 'Apresentação', paragraphs: ['Texto'] }],
    monthlySections: ['laboratory', 'supplies']
    // monthlyRequirements is undefined
  };
  d.data.sources = [source];
  d.data.lab = [lab({ id: 'dbo', parameter: 'DBO', date: '2026-10-15' }), lab({ id: 'dqo', parameter: 'DQO', date: '2026-10-15' })];
  d.selection.selectedLabIds = ['dbo', 'dqo'];
  const preset = getReportPreset('demo13', 'etdi');
  const issues = validateClientReport(d, preset);
  // Without monthlyRequirements, supplies in monthlySections was treated as required
  assert.ok(issues.some(i => i.code === 'section-missing' && i.message.includes('insumos')));
});
