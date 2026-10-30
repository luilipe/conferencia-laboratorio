import test from 'node:test';import assert from 'node:assert/strict';
import {assertSnapshotRenderer} from '../lib/client-reports/snapshot.ts';
import {preferredReportRenderer,getReportPreset} from '../lib/client-reports/presets.ts';
import {reportPdfPreviewKey} from '../lib/client-reports/pdf-preview.ts';
import {makeDraft,lab,v,source} from './fixtures/client-report-fixtures.mjs';
import {buildReportDocument} from '../lib/client-reports/document.ts';
import {validateClientReport} from '../lib/client-reports/validation.ts';

test('leitores rejeitam renderizador v4 disfarçado como legado, antes de exportar ou finalizar',()=>{
 const draft=makeDraft({presetVersion:'2',documentRendererVersion:'4'}),snapshot={draft,document:{rendererVersion:'4'}};
 assert.throws(()=>assertSnapshotRenderer(snapshot,'3'),/renderizador/i);assert.doesNotThrow(()=>assertSnapshotRenderer(snapshot,'4'));
 assert.throws(()=>assertSnapshotRenderer({...snapshot,document:{rendererVersion:'3'}},'3'),/renderizador/i);
 assert.doesNotThrow(()=>assertSnapshotRenderer({draft:makeDraft(),document:{rendererVersion:'1'}},'1'));
});
test('novo relatório mantém v3 quando a estação ainda não habilitou v4',()=>{
 const s={clientId:'demo13',identities:{},mappings:[],references:[],enabledPresetVersions:['etdi@2'],updatedByUid:'admin'};
 assert.equal(preferredReportRenderer(s,'demo13','etdi'),'3');assert.equal(preferredReportRenderer(null,'demo13','etdi'),'3');
 const modern={...s,technicalApproverUid:'marco',enabledRendererVersions:{etdi:['4']},editorialModels:{etdi:{approvedByUid:'admin'}}};assert.equal(preferredReportRenderer(modern,'demo13','etdi'),'4');assert.equal(preferredReportRenderer(modern,'demo13','biologico'),'3');
});
test('PDF conferido é vinculado a relatório, versão, hash, modo e estado salvo',()=>{
 const content={id:'a',mode:'draft'},version={versionId:'v1',sha256:'a'.repeat(64)};const k=reportPdfPreviewKey(content,version,false);
 for(const [d,v,dirty] of [[{id:'b',mode:'draft'},version,false],[content,{...version,versionId:'v2'},false],[content,{...version,sha256:'b'.repeat(64)},false],[{...content,mode:'finalized'},version,false],[content,version,true]])assert.notEqual(reportPdfPreviewKey(d,v,dirty),k);
});
test('v4 não imprime nem libera eficiência de campanhas incompatíveis na mesma data',()=>{
 const d=makeDraft({presetVersion:'2',documentRendererVersion:'4'});d.data.sources=[source];d.data.lab=[lab({campaignId:'morning'}),lab({id:'out',pointId:'tratado',value:v(125.4),campaignId:'evening'})];d.selection.selectedLabIds=['lab-1','out'];d.selection.efficiencyPairs=[{parameter:'DBO',inletId:'lab-1',outletId:'out',declaredId:null}];
 const p=getReportPreset('demo13','etdi'),doc=buildReportDocument(d,p,'draft');assert.ok(validateClientReport(d,p).some(i=>i.code==='efficiency-pair-invalid'&&i.severity==='blocker'));assert.ok(!(JSON.stringify(doc.sections.find(s=>s.id==='efficiency'))??'').includes('90,00'));
});
