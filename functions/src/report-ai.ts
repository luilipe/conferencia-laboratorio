import {GoogleGenAI} from '@google/genai';
import {FieldValue} from 'firebase-admin/firestore';
import {createHash,randomUUID} from 'node:crypto';
import type {NarrativeContext,ReportClientSettings,ReportServiceRequest} from '../../lib/client-reports/types.ts';
import {adminDb,assertReportAccess} from '../../backend/report-access.ts';
import {readReportSnapshot,validateReportServiceRequest} from '../../backend/report-snapshot.ts';
import {buildNarrativeContext,narrativeContextHash} from '../../lib/client-reports/narrative-context.ts';
import {resolveReportPreset} from '../../lib/client-reports/presets.ts';
import {generateNarrativeForContext} from './report-ai-core.ts';
import {canonicalReportJson} from '../../lib/client-reports/snapshot.ts';
import {NARRATIVE_SCHEMA,REPORT_AI_INSTRUCTIONS,REPORT_AI_PROMPT_VERSION} from './report-ai-prompt.ts';
export async function generateReportNarrative(uid:string,value:ReportServiceRequest,apiKey:string){
 const request=validateReportServiceRequest(value);await assertReportAccess(uid);const snapshot=await readReportSnapshot(request);await assertReportAccess(uid,snapshot.draft.clientId);
 if(snapshot.version.status!=='draft'||snapshot.document.rendererVersion!=='4')throw new Error('Geração disponível somente para um rascunho moderno salvo.');
 const db=adminDb(),settings=(await db.doc(`clientReportClients/${snapshot.draft.clientId}`).get()).data() as ReportClientSettings|undefined;
 if(snapshot.draft.references.some(r=>!settings?.references.some(approved=>canonicalReportJson(approved)===canonicalReportJson(r))))throw new Error('Confira as referências do rascunho com o cadastro técnico antes de gerar.');
 const context=buildNarrativeContext(snapshot.draft,resolveReportPreset(settings??null,snapshot.draft.clientId,snapshot.draft.stationId,snapshot.draft.presetVersion,'4'));
 const contextHash=await narrativeContextHash(context),model=process.env.REPORT_AI_MODEL;
 if(!model||!apiKey)throw new Error('Gemini ainda não configurado. A edição manual e a sugestão factual continuam disponíveis.');
 const key=createHash('sha256').update([request.reportId,request.versionId,request.expectedSha256,contextHash,model,REPORT_AI_PROMPT_VERSION].join('|')).digest('hex');
 const root=db.doc(`clientReports/${request.reportId}`),index=db.doc(`reportAiRequests/${key}`),lock=db.doc(`reportAiLocks/${request.reportId}`),usage=db.doc(`reportAiUsage/${uid}`),now=Date.now();
 const generationId=await db.runTransaction(async tx=>{
  const [existing,active,rate,current]=await Promise.all([tx.get(index),tx.get(lock),tx.get(usage),tx.get(root)]);
  if(current.data()?.currentVersionId!==request.versionId||current.data()?.status!=='draft')throw new Error('A versão mudou. Salve e confira novamente.');
  if(existing.data()?.status==='succeeded')return existing.data()!.generationId as string;
  if(active.data()?.until>now)throw new Error('Já existe uma geração ativa para este relatório.');
  const recent=(rate.data()?.calls??[]).filter((t:number)=>t>now-60000);if(recent.length>=3)throw new Error('Limite de três solicitações por minuto. Aguarde antes de tentar novamente.');
  const id=randomUUID();tx.set(index,{generationId:id,status:'pending',startedAt:FieldValue.serverTimestamp()});tx.set(lock,{generationId:id,until:now+120000});tx.set(usage,{calls:[...recent,now]});tx.set(root.collection('aiGenerations').doc(id),{status:'pending',uid,sourceVersionId:request.versionId,contextHash,model,promptVersion:REPORT_AI_PROMPT_VERSION,createdAt:FieldValue.serverTimestamp()});return id;
 });
 const generation=root.collection('aiGenerations').doc(generationId),cached=(await generation.get()).data();
 if(cached?.status==='succeeded')return {generationId,contextHash,suggestion:cached.suggestion,model,promptVersion:REPORT_AI_PROMPT_VERSION};
 const started=Date.now();try{
  const ai=new GoogleGenAI({apiKey,httpOptions:{timeout:45000}});let inputTokens=0,outputTokens=0;
  const suggestion=await generateNarrativeForContext(context,async(ctx:NarrativeContext)=>{
   const {inputKey,...minimal}=ctx;void inputKey;const contents=JSON.stringify(minimal),count=await ai.models.countTokens({model,contents});
   if((count.totalTokens??Math.ceil(contents.length/3))>20000)throw new Error('Contexto acima do limite de IA. Revise manualmente ou prepare uma seleção técnica menor; nenhum resultado foi cortado.');
   const response=await ai.models.generateContent({model,contents,config:{systemInstruction:REPORT_AI_INSTRUCTIONS,responseMimeType:'application/json',responseJsonSchema:NARRATIVE_SCHEMA,maxOutputTokens:2000,temperature:0.2}});
   inputTokens=response.usageMetadata?.promptTokenCount??0;outputTokens=response.usageMetadata?.candidatesTokenCount??0;
   if(!response.text)throw new Error('O modelo não retornou uma sugestão.');return JSON.parse(response.text);
  });
  await db.runTransaction(async tx=>{const held=await tx.get(lock);tx.update(generation,{status:'succeeded',suggestion,inputTokens,outputTokens,durationMs:Date.now()-started,completedAt:FieldValue.serverTimestamp()});tx.set(index,{generationId,status:'succeeded'});if(held.data()?.generationId===generationId)tx.delete(lock);});
  return {generationId,contextHash,suggestion,model,promptVersion:REPORT_AI_PROMPT_VERSION};
 }catch(error){await db.runTransaction(async tx=>{const held=await tx.get(lock);tx.update(generation,{status:'failed',durationMs:Date.now()-started,errorCode:'generation-failed',completedAt:FieldValue.serverTimestamp()});tx.set(index,{generationId,status:'failed'});if(held.data()?.generationId===generationId)tx.delete(lock);});throw error;}
}
