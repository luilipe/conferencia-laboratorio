import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {defineSecret} from 'firebase-functions/params';
import {generateReportNarrative as generate} from './report-ai.ts';
import {finalizeReportV4 as finalize} from './finalize-report.ts';
const key=defineSecret('GEMINI_API_KEY');
const options={region:process.env.REPORTS_REGION??'southamerica-east1',enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true',timeoutSeconds:90,maxInstances:2};
function message(error:unknown){return error instanceof Error?error.message:'Não foi possível processar esta versão.';}
export const generateReportNarrative=onCall({...options,secrets:[key]},async request=>{if(!request.auth)throw new HttpsError('unauthenticated','Autenticação obrigatória.');try{return await generate(request.auth.uid,request.data,key.value());}catch(error){throw new HttpsError('failed-precondition',message(error));}});
export const finalizeReportV4=onCall(options,async request=>{if(!request.auth)throw new HttpsError('unauthenticated','Autenticação obrigatória.');try{return await finalize(request.auth.uid,request.data);}catch(error){throw new HttpsError('failed-precondition',message(error));}});
