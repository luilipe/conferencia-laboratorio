import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReportValue, convertReportValue, formatReportValue, reportDate, normalizeParameter } from '../lib/client-reports/values.ts';
import { getReportPreset, REPORT_PRESETS } from '../lib/client-reports/presets.ts';

test('preserva original, qualificadores, ausências e unidades sem inferir números', () => {
  const v = parseReportValue('< 2,0', 'µg/L');
  assert.equal(v.operator, '<'); assert.equal(v.raw, '< 2,0');
  assert.equal(convertReportValue(v, 'mg/L').value, .002);
  assert.equal(parseReportValue('Ausência', '').qualitative, 'Ausência');
  assert.equal(parseReportValue('', 'mg/L').status, 'missing');
  assert.equal(parseReportValue('#DIV/0!', 'mg/L').status, 'invalid');
  assert.equal(parseReportValue('65.443', 'm³').status, 'invalid');
  assert.equal(parseReportValue(0, 'mL/L').value, 0);
  assert.equal(parseReportValue('1.254,00', 'mg/L', {decimalMode:'pt-BR',allowThousands:true}).value,1254);
  assert.equal(parseReportValue('7.50','',{decimalMode:'dot',allowThousands:false}).value,7.5);
  assert.equal(convertReportValue(parseReportValue(2,'kg'),'L').status,'invalid');
  assert.equal(convertReportValue(parseReportValue(2,'prensa'),'kg').status,'invalid');
  assert.equal(formatReportValue(v),'< 2,00 µg/L');
  assert.equal(normalizeParameter('DBO₅'),'DBO');
});
test('datas civis e oito modelos rascunho', () => {
  assert.equal(reportDate('03/08/2026 12:10'),'2026-08-03');
  assert.equal(reportDate('31/02/2026'),null);
  assert.equal(reportDate(46237),'2026-08-03');
  assert.equal(getReportPreset('demo01','ete').points.length,5);
  assert.equal(REPORT_PRESETS.length,8);
  assert.ok(REPORT_PRESETS.every(p=>!p.enabled));
});
