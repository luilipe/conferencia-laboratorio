import test from 'node:test';import assert from 'node:assert/strict';
import {serializeReportSnapshot,deserializeReportSnapshot} from '../lib/client-reports/store.ts';import {makeDraft} from './fixtures/client-report-fixtures.mjs';import {buildReportDocument} from '../lib/client-reports/document.ts';import {getReportPreset} from '../lib/client-reports/presets.ts';
test('partes UTF-8 limitadas, sem separar Unicode; faltas/repetições/adulteração rejeitadas',async()=>{
 const draft=makeDraft();draft.narratives.observations='Registro µ ≤ ₅ 🌍 '.repeat(60000);const document=buildReportDocument(draft,getReportPreset('demo13','etdi'),'draft');const serialized=await serializeReportSnapshot({draft,document});assert.ok(serialized.totalBytes>1024*1024);assert.ok(serialized.chunks.every(c=>new TextEncoder().encode(c.payload).length<=200*1024));assert.equal((await deserializeReportSnapshot(serialized)).draft.narratives.observations,draft.narratives.observations);
 await assert.rejects(deserializeReportSnapshot({...serialized,chunks:serialized.chunks.slice(1)}),/parte|sequência/i);
 await assert.rejects(deserializeReportSnapshot({...serialized,chunks:[...serialized.chunks,serialized.chunks[0]]}),/parte|sequência/i);
 await assert.rejects(deserializeReportSnapshot({...serialized,chunks:serialized.chunks.map((c,i)=>i===0?{...c,payload:c.payload+'x'}:c)}),/integridade/i);
});
