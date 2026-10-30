import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {getAuth} from 'firebase-admin/auth';import {Timestamp} from 'firebase-admin/firestore';
import {adminDb,assertReportAccess} from '../../backend/report-access.ts';
import {readReportSnapshot} from '../../backend/report-snapshot.ts';
import {finalizeReportV4} from '../src/finalize-report.ts';
import {generateReportNarrative} from '../src/report-ai.ts';
import {createReportPdfServer} from '../../services/report-pdf/src/server.ts';
import {makeDraft,lab,source} from '../../tests/fixtures/client-report-fixtures.mjs';
import {buildReportDocument} from '../../lib/client-reports/document.ts';
import {getReportPreset} from '../../lib/client-reports/presets.ts';
import {getEditorialProposal,initialReportEditorial} from '../../lib/client-reports/editorial.ts';
import {buildNarrativeContext,narrativeContextHash} from '../../lib/client-reports/narrative-context.ts';
import {conclusionDataKey} from '../../lib/client-reports/conclusion.ts';
import {serializeReportSnapshot} from '../../lib/client-reports/snapshot.ts';
let db,request,settings,draft,server;
before(async()=>{
 if(process.env.GCLOUD_PROJECT!=='demo-client-reports'||!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')||!process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:'))throw new Error('Somente emuladores locais.');
 db=adminDb();for(const uid of ['marco-uid','outro-uid','inactive']){await getAuth().createUser({uid,email:`${uid}@example.com`,emailVerified:true,password:'LocalTestOnly-123!'});await db.doc(`users/${uid}`).set({active:uid!=='inactive',role:'reviewer',displayName:uid==='outro-uid'?'Marco':'Responsável de teste'});}
 draft=makeDraft({id:'backend-v4',presetVersion:'2',documentRendererVersion:'4'});draft.revision=1;draft.data.sources=[source];draft.data.lab=[lab({id:'dbo'}),lab({id:'dqo',parameter:'DQO'})];draft.selection.selectedLabIds=['dbo','dqo'];draft.narratives.methodology='Descrição de demonstração';draft.narratives.methodologySource='Fonte sintética';draft.fixedText={source:{fileName:'Modelo sintético',sha256:'a'.repeat(64)},sections:[{id:'presentation',title:'Apresentação',paragraphs:['Texto-base sintético.']}]};
 const editorial={...getEditorialProposal('demo13','etdi'),sourceHash:'a'.repeat(64),approvedByUid:'marco-uid',approvedAt:'2026-10-26'};draft.editorialModel=editorial;draft.editorial=initialReportEditorial(buildNarrativeContext(draft,getReportPreset('demo13','etdi')));draft.conclusionState={dataKey:conclusionDataKey(draft),reviewed:true};
 settings={clientId:'demo13',identities:{},mappings:[],references:[],updatedByUid:'admin',technicalApproverUid:'marco-uid',enabledPresetVersions:['etdi@2'],enabledRendererVersions:{etdi:['4']},editorialModels:{etdi:editorial}};await db.doc('clientReportClients/demo13').set(settings);request=await writeSnapshot(draft,'version-1');
});
async function writeSnapshot(d,versionId){const document=buildReportDocument(d,getReportPreset('demo13','etdi'),'draft'),serialized=await serializeReportSnapshot({draft:d,document}),ref=db.doc(`clientReports/${d.id}/versions/${versionId}`),batch=db.batch();batch.set(ref,{reportId:d.id,versionId,clientId:d.clientId,stationId:d.stationId,period:d.period,revision:d.revision,status:'draft',createdByUid:'marco-uid',createdAt:Timestamp.now(),review:null,reviewedAt:null,presetVersion:d.presetVersion,rendererVersion:'4',chunkCount:serialized.chunks.length,sha256:serialized.sha256,totalBytes:serialized.totalBytes});for(const c of serialized.chunks)batch.set(ref.collection('chunks').doc(String(c.sequence)),c);batch.set(db.doc(`clientReports/${d.id}`),{clientId:d.clientId,stationId:d.stationId,period:d.period,revision:d.revision,currentVersionId:versionId,status:'draft'});await batch.commit();return {reportId:d.id,versionId,expectedSha256:serialized.sha256};}
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db?.terminate();});
test('backend lê snapshot por hash e recusa usuário inativo e alteração de versão',async()=>{assert.equal((await readReportSnapshot(request)).draft.id,'backend-v4');await assert.rejects(()=>assertReportAccess('inactive'),/autorizado/);await assert.rejects(()=>readReportSnapshot({...request,expectedSha256:'b'.repeat(64)}),/alterada|ausente/);});
test('aprovação v4 valida UID, conteúdo revisado, concorrência e registra hash imutável',async()=>{
 await assert.rejects(()=>finalizeReportV4('outro-uid',{...request,acceptedWarnings:[]}),/responsável/);
 const changed=structuredClone(draft);changed.revision=2;changed.editorial.scope='Escopo alterado';const stale=await writeSnapshot(changed,'version-stale');await assert.rejects(()=>finalizeReportV4('marco-uid',{...stale,acceptedWarnings:[]}),/Revise/);
 await db.doc('clientReports/backend-v4').update({currentVersionId:'version-1',revision:1});
 const both=await Promise.allSettled([1,2].map(()=>finalizeReportV4('marco-uid',{...request,acceptedWarnings:[]})));assert.equal(both.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.doc('clientReports/backend-v4/approvals/version-1').get()).data().sha256,request.expectedSha256);
});
test('geração reaproveita resposta, bloqueia concorrência e limite sem chamar API real',async()=>{
 request=await writeSnapshot({...draft,revision:3},'version-ai');const context=buildNarrativeContext({...draft,revision:3},getReportPreset('demo13','etdi')),contextHash=await narrativeContextHash(context),model=process.env.REPORT_AI_MODEL;
 const key=createHash('sha256').update([request.reportId,request.versionId,request.expectedSha256,contextHash,model,'1'].join('|')).digest('hex');const suggestion={conclusion:'Proposta sintética salva',summary:[],actions:[],claims:[],limitations:[]};
 await db.doc(`reportAiRequests/${key}`).set({status:'succeeded',generationId:'cached'});await db.doc('clientReports/backend-v4/aiGenerations/cached').set({status:'succeeded',suggestion});assert.equal((await generateReportNarrative('marco-uid',request,'never-used')).generationId,'cached');
 await db.doc(`reportAiRequests/${key}`).delete();await db.doc('reportAiLocks/backend-v4').set({generationId:'active',until:Date.now()+120000});await assert.rejects(()=>generateReportNarrative('marco-uid',request,'never-used'),/ativa/);await db.doc('reportAiLocks/backend-v4').delete();await db.doc('reportAiUsage/marco-uid').set({calls:[Date.now(),Date.now(),Date.now()]});await assert.rejects(()=>generateReportNarrative('marco-uid',request,'never-used'),/Limite/);
});
test('endpoint PDF exige autenticação e devolve PDF do snapshot salvo',async()=>{
 server=createReportPdfServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/reports/pdf`;
 assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,400);
 const auth=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'marco-uid@example.com',password:'LocalTestOnly-123!',returnSecureToken:true})});assert.equal(auth.status,200);const token=(await auth.json()).idToken;
 const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(request)});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/pdf/);assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,4).toString(),'%PDF');
});
