import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc,getDocs,collection,writeBatch,serverTimestamp} from 'firebase/firestore';
import {saveClientReport,loadClientReportVersion,finalizeClientReport,saveReportClientSettings,listClientReports,listClientReportVersions} from '../../lib/client-reports/store.ts';import {makeDraft,lab,source} from '../fixtures/client-report-fixtures.mjs';
import {loadMonthlyReportSources} from '../../lib/client-reports/store.ts';
import {createReportDraft} from '../../lib/client-reports/presets.ts';
import {conclusionDataKey} from '../../lib/client-reports/conclusion.ts';
test('leitor busca coleta e não competência de publicação; isola cliente e preserva consulta',async()=>{
 const d=makeDraft({id:'sources-by-collection',clientId:'demo14',stationId:'eta',period:'2026-10'});d.data.sources=[source];d.data.lab=[lab({id:'current-collection',stationId:'eta',date:'2026-09-01',publicationDate:'2026-10-05'})];d.selection.selectedLabIds=['current-collection'];
 await saveClientReport(db,d,0,'reviewer-1');
 const target=createReportDraft('demo14','eta','2026-09'),batch=await loadMonthlyReportSources(db,target);assert.ok(batch.lab.some(r=>r.id==='current-collection'));assert.equal(batch.supplies.length,0);assert.ok(batch.lab[0].source.externalRecordId.includes('sources-by-collection'));
});

test('leitor reúne registros de uma mesma fonte parcialmente selecionada em relatórios diferentes',async()=>{
 const shared={...source,id:'shared-partial',sha256:'d'.repeat(64)};
 for(const [id,parameter] of [['partial-a','DBO'],['partial-b','DQO']]){
  const d=makeDraft({id,clientId:'demo02',stationId:'ete',period:'2026-09'});
  d.data.sources=[shared];d.data.lab=[lab({id:parameter,stationId:'ete',parameter,source:{sourceId:shared.id}})];d.selection.selectedLabIds=[parameter];
  await saveClientReport(db,d,0,'reviewer-1');
 }
 const data=await loadMonthlyReportSources(db,createReportDraft('demo02','ete','2026-09'));
 assert.deepEqual(data.lab.map(r=>r.parameter).sort(),['DBO','DQO']);assert.equal(data.sources.length,1);
});
let env,db,admin;const pid='demo-client-reports';
before(async()=>{const host=process.env.FIRESTORE_EMULATOR_HOST;if(!host||!/^127\.0\.0\.1:|^localhost:/.test(host))throw new Error('Teste permitido apenas no emulador local demo-client-reports.');env=await initializeTestEnvironment({projectId:pid,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});const auth=uid=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:true}).firestore();db=auth('reviewer-1');admin=auth('admin-1');await env.withSecurityRulesDisabled(async c=>{for(const [uid,role,active] of [['reviewer-1','reviewer',true],['reviewer-2','reviewer',true],['admin-1','administrator',true],['inactive','reviewer',false]])await setDoc(doc(c.firestore(),'users',uid),{role,active});});});
after(async()=>{await env?.cleanup();});
const valid=(id)=>{const d=makeDraft();d.id=id;d.data.sources=[source];d.data.lab=[lab({id:'dbo'}),lab({id:'dqo',parameter:'DQO'})];return d;};
const settings={clientId:'demo13',identities:{},mappings:[],enabledPresetVersions:['etdi@1'],references:[],updatedByUid:'admin-1'};

test('configuração moderna só por administrador; conclusão IA e aprovação não são graváveis pelo cliente',async()=>{
 const modern={...settings,enabledPresetVersions:['etdi@2'],technicalApproverUid:'reviewer-2',enabledRendererVersions:{etdi:['4']},editorialModels:{etdi:{version:'1',sourceHash:'a'.repeat(64),approvedByUid:'admin-1',approvedAt:'2026-10-26',sections:[{id:'presentation',title:'Apresentação',paragraphs:['Texto aprovado de teste.']}]}}};
 await assertSucceeds(saveReportClientSettings(admin,modern,'admin-1'));await assertFails(saveReportClientSettings(db,modern,'reviewer-1'));
 const d=valid('modern-direct-final');d.presetVersion='2';d.documentRendererVersion='4';const version=await saveClientReport(db,d,0,'reviewer-1');const batch=writeBatch(db);batch.update(doc(db,'clientReports',d.id,'versions',version.versionId),{status:'finalized',review:{actorUid:'reviewer-1',actorName:'Marco',acceptedWarnings:[]},reviewedAt:serverTimestamp()});batch.update(doc(db,'clientReports',d.id),{status:'finalized',updatedAt:serverTimestamp()});await assertFails(batch.commit());
 await assertFails(setDoc(doc(db,'clientReports',d.id,'aiGenerations','fake'),{status:'succeeded'}));await assertFails(setDoc(doc(db,'clientReports',d.id,'approvals','fake'),{actorUid:'reviewer-1'}));await saveReportClientSettings(admin,settings,'admin-1');
 await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),'clientReports',d.id,'versions',version.versionId),{rendererVersion:'3'}));
 await assert.rejects(()=>loadClientReportVersion(db,d.id,version.versionId),/renderizador/i);
 await assert.rejects(()=>finalizeClientReport(db,d.id,version.versionId,1,{actorUid:'reviewer-1',actorName:'Marco',acceptedWarnings:[]}),/renderizador/i);
});
test('novo fluxo bloqueia conclusão não revisada e aprovação herdada do renderizador anterior',async()=>{
 const d=valid('monthly-review-gate');d.presetVersion='2';d.documentRendererVersion='3';
 d.narratives.methodology='Descrição sintética';d.narratives.methodologySource='Fonte de teste';d.fixedText={source:{fileName:'Modelo sintético',sha256:'a'.repeat(64)},sections:[{id:'presentation',title:'Apresentação',paragraphs:['Texto sintético']} ]};d.conclusionState={dataKey:conclusionDataKey(d),reviewed:false};
 await saveReportClientSettings(admin,{...settings,enabledPresetVersions:['etdi@2']},'admin-1');
 const v1=await saveClientReport(db,d,0,'reviewer-1');await assert.rejects(finalizeClientReport(db,d.id,v1.versionId,1,{actorUid:'reviewer-1',actorName:'Teste',acceptedWarnings:[]}),/conclusão/);
 d.revision=1;d.conclusionState.reviewed=true;const v2=await saveClientReport(db,d,1,'reviewer-1');await assert.rejects(finalizeClientReport(db,d.id,v2.versionId,2,{actorUid:'reviewer-1',actorName:'Teste',acceptedWarnings:[]}),/impedimentos/);
 await saveReportClientSettings(admin,settings,'admin-1');
});
test('preferência mensal validada somente por administrador e limitada a três meses',async()=>{
 const base={...settings,labComparisonPreferences:{etdi:{version:1,previousMonths:2}}};await assertSucceeds(saveReportClientSettings(admin,base,'admin-1'));
 await assertFails(saveReportClientSettings(db,base,'reviewer-1'));
 for(const preferences of [{etdi:{version:1,previousMonths:4}},{etdi:{version:2,previousMonths:1}},{outra:{version:1,previousMonths:1}}])await assertFails(saveReportClientSettings(admin,{...base,labComparisonPreferences:preferences},'admin-1'));
 await saveReportClientSettings(admin,settings,'admin-1');
});
test('emissão v2 exige @2 e preserva snapshot após alteração de cadastro',async()=>{
 await saveReportClientSettings(admin,settings,'admin-1');const d=valid('version-2-gate');d.presetVersion='2';d.narratives.methodology='Descrição sintética revisada';d.narratives.methodologySource='Fonte sintética';const v=await saveClientReport(db,d,0,'reviewer-1');
 await assert.rejects(finalizeClientReport(db,d.id,v.versionId,1,{actorUid:'reviewer-1',actorName:'Revisor',acceptedWarnings:[]}),/impedimentos/i);
 await saveReportClientSettings(admin,{...settings,enabledPresetVersions:['etdi@2'],identities:{etdi:{facilityName:'Cadastro alterado'}}},'admin-1');
 await assertSucceeds(finalizeClientReport(db,d.id,v.versionId,1,{actorUid:'reviewer-1',actorName:'Revisor',acceptedWarnings:[]}));
 const saved=await loadClientReportVersion(db,d.id,v.versionId);assert.equal(saved.document.rendererVersion,'2');assert.equal(saved.document.identity.facilityName,d.identity.facilityName);assert.equal(saved.version.status,'finalized');await saveReportClientSettings(admin,settings,'admin-1');
});
test('cadastro administrativo com origens opcionais, limites e concorrência',async()=>{
 const s={...settings,clientId:'demo09',enabledPresetVersions:[],identitySources:{ete:[{fileName:'sintetico.xlsx',sha256:'a'.repeat(64),fields:['phone'],importedByUid:'admin-1',importedAt:'2026-10-06T12:00:00Z'}]},enabledOptionalCharts:{}};
 await assertSucceeds(saveReportClientSettings(admin,s,'admin-1',null));
 await assertFails(saveReportClientSettings(db,s,'reviewer-1'));
 for(const bad of [{identitySources:{ete:Array(11).fill(s.identitySources.ete[0])}},{identitySources:{ete:[{...s.identitySources.ete[0],sha256:'invalid'}]}},{enabledOptionalCharts:{'ete@2':['arbitrary']}},{identitySources:{other:[]}}])await assertFails(saveReportClientSettings(admin,{...s,...bad},'admin-1'));
 const current=(await getDoc(doc(admin,'clientReportClients','demo09'))).data();
 const results=await Promise.allSettled(['A','B'].map(phone=>saveReportClientSettings(admin,{...s,identities:{ete:{phone}}},'admin-1',current)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/conflito/i);
});
test('conflito simultâneo preserva versão e partes publicadas são imutáveis',async()=>{
 const d=valid('concurrency');const results=await Promise.allSettled([saveClientReport(db,d,0,'reviewer-1'),saveClientReport(db,d,0,'reviewer-1')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/conflito/i);
 const v=results.find(r=>r.status==='fulfilled').value;const stored=await loadClientReportVersion(db,d.id,v.versionId);assert.equal(stored.draft.period,'2026-09');assert.equal(stored.document.revision,1);
 const chunk=doc(db,'clientReports',d.id,'versions',v.versionId,'chunks','0');await assertFails(updateDoc(chunk,{payload:'alterado'}));await assertFails(deleteDoc(chunk));await assertFails(updateDoc(doc(db,'clientReports',d.id),{createdByUid:'reviewer-2'}));assert.equal((await listClientReportVersions(db,d.id)).length,1);
});
test('cadastro administrativo, revisão obrigatória, versão final e nova correção',async()=>{
 await assertFails(saveReportClientSettings(db,settings,'reviewer-1'));await assertSucceeds(saveReportClientSettings(admin,settings,'admin-1'));
 const d=valid('review');const v=await saveClientReport(db,d,0,'reviewer-1');await assert.rejects(finalizeClientReport(db,d.id,v.versionId,1,{actorUid:'reviewer-1',actorName:'',acceptedWarnings:[]}),/revisão/i);
 await finalizeClientReport(db,d.id,v.versionId,1,{actorUid:'reviewer-1',actorName:'Revisor sintético',acceptedWarnings:[]});const first=await loadClientReportVersion(db,d.id,v.versionId);assert.equal(first.document.mode,'finalized');
 await assertFails(updateDoc(doc(db,'clientReports',d.id,'versions',v.versionId),{sha256:'b'.repeat(64)}));await assertFails(updateDoc(doc(db,'clientReports',d.id,'versions',v.versionId),{reviewedAt:serverTimestamp()}));
 first.draft.narratives.conclusion='Correção técnica em nova versão';const next=await saveClientReport(db,first.draft,1,'reviewer-1');assert.equal(next.status,'draft');assert.equal((await loadClientReportVersion(db,d.id,v.versionId)).draft.narratives.conclusion,d.narratives.conclusion);
});
test('externo, não verificado, inativo e anônimo não acessam relatórios',async()=>{
 for(const context of [env.unauthenticatedContext(),env.authenticatedContext('external',{email:'someone@example.com',email_verified:true}),env.authenticatedContext('reviewer-1',{email:'r@example.com',email_verified:false}),env.authenticatedContext('inactive',{email:'inactive@example.com',email_verified:true})]){const other=context.firestore();await assertFails(getDoc(doc(other,'clientReports','review')));await assertFails(setDoc(doc(other,'clientReports','forged'),{createdByUid:'external'}));}
});
test('gravação interrompida não publica; ponteiro estrangeiro e finalização forjada recusados',async()=>{
 const ref=doc(db,'clientReports','interrupted','versions','writing');const writing={reportId:'interrupted',versionId:'writing',clientId:'demo13',stationId:'etdi',period:'2026-09',baseRevision:0,revision:1,status:'writing',createdByUid:'reviewer-1',createdAt:serverTimestamp(),review:null,reviewedAt:null,presetVersion:'1',rendererVersion:'1',chunkCount:2,sha256:'a'.repeat(64),totalBytes:2};await setDoc(ref,writing);await setDoc(doc(ref,'chunks','0'),{sequence:0,payload:'x',sha256:'a'.repeat(64)});assert.equal((await getDoc(doc(db,'clientReports','interrupted'))).exists(),false);await assert.rejects(loadClientReportVersion(db,'interrupted','writing'),/parte/i);
 await assertFails(setDoc(doc(db,'clientReports','interrupted'),{clientId:'demo13',stationId:'etdi',period:'2026-09',revision:1,currentVersionId:'writing',status:'draft',createdByUid:'reviewer-1',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 const other=env.authenticatedContext('reviewer-2',{email:'r2@example.com',email_verified:true}).firestore();await assertFails(setDoc(doc(other,'clientReports','interrupted','versions','foreign'),{...writing,versionId:'foreign'}));
 await assertFails(updateDoc(doc(db,'clientReports','review'),{currentVersionId:'writing'}));
});
test('400 partes respeitam limites de acessos das regras e bytes UTF-8',async()=>{
 const ref=doc(db,'clientReports','large','versions','writing');await setDoc(ref,{reportId:'large',versionId:'writing',clientId:'demo13',stationId:'etdi',period:'2026-09',baseRevision:0,revision:1,status:'writing',createdByUid:'reviewer-1',createdAt:serverTimestamp(),review:null,reviewedAt:null,presetVersion:'1',rendererVersion:'1',chunkCount:400,sha256:'a'.repeat(64),totalBytes:400});const batch=writeBatch(db);for(let i=0;i<400;i++)batch.set(doc(ref,'chunks',String(i)),{sequence:i,payload:'x',sha256:'a'.repeat(64)});await assertSucceeds(batch.commit());assert.equal((await getDocs(collection(ref,'chunks'))).size,400);
 await assertFails(setDoc(doc(ref,'chunks','400'),{sequence:400,payload:'x',sha256:'a'.repeat(64)}));
 const byteRef=doc(db,'clientReports','byte-limit','versions','writing');await setDoc(byteRef,{...(await getDoc(ref)).data(),reportId:'byte-limit',chunkCount:1,totalBytes:400,createdAt:serverTimestamp()});
 await assertFails(setDoc(doc(byteRef,'chunks','0'),{sequence:0,payload:'🌍'.repeat(60000),sha256:'a'.repeat(64)}));
 await assertSucceeds(setDoc(doc(byteRef,'chunks','0'),{sequence:0,payload:'🌍'.repeat(100),sha256:'a'.repeat(64)}));
});
test('histórico com mais de 20 registros pagina sem perder ou repetir e filtra',async()=>{
 for(let i=0;i<23;i++)await saveClientReport(db,valid(`page-${String(i).padStart(2,'0')}`),0,'reviewer-1');const seen=new Set();let cursor;do{const page=await listClientReports(db,{clientId:'demo13',period:'2026-09'},cursor);assert.ok(page.items.length<=20);for(const r of page.items){assert.ok(!seen.has(r.id));seen.add(r.id);assert.equal(r.period,'2026-09');assert.equal(r.clientId,'demo13');}cursor=page.nextCursor??undefined;}while(cursor);assert.ok(seen.size>=25);
});
