import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {getAuth} from 'firebase-admin/auth';
import {getAppCheck} from 'firebase-admin/app-check';
import {assertReportAccess,adminDb} from '../../../backend/report-access.ts';
import {readReportSnapshot,validateReportServiceRequest} from '../../../backend/report-snapshot.ts';
import {renderReportPdf} from './render.ts';
export function createReportPdfServer(){let processing=false;return createServer(async(req,res)=>{
 const origin=req.headers.origin,allowed=(process.env.REPORTS_ALLOWED_ORIGINS??'').split(',').filter(Boolean);
 if(origin&&!allowed.includes(origin)){res.writeHead(403).end();return;}
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,X-Firebase-AppCheck');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');}
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
 if(req.url==='/health'){res.writeHead(200).end('ok');return;}
 if(req.method!=='POST'||req.url!=='/reports/pdf'){res.writeHead(404).end();return;}
 if(processing){res.writeHead(429,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Já existe uma exportação em andamento. Tente novamente em instantes.'}));return;}
 processing=true;try{
  adminDb();const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!bearer)throw new Error('Autenticação obrigatória.');const token=await getAuth().verifyIdToken(bearer,true);await assertReportAccess(token.uid);
  const local=process.env.REPORTS_EMULATOR==='true'&&process.env.GCLOUD_PROJECT==='demo-client-reports';if(!local){const check=req.headers['x-firebase-appcheck'];if(typeof check!=='string')throw new Error('Verificação do aplicativo obrigatória.');await getAppCheck().verifyToken(check);}
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)throw new Error('Pedido acima do limite.');}
  const request=validateReportServiceRequest(JSON.parse(body)),snapshot=await readReportSnapshot(request);await assertReportAccess(token.uid,snapshot.draft.clientId);
  if(snapshot.document.rendererVersion!=='4')throw new Error('Use a exportação original para esta versão.');
  const pdf=await renderReportPdf(snapshot.document);res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${snapshot.draft.clientId}_${snapshot.draft.stationId}_${snapshot.draft.period}_v${snapshot.draft.revision}.pdf"`}).end(pdf);
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:error instanceof Error?error.message:'Não foi possível gerar o PDF.'}));}finally{processing=false;}
 });}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createReportPdfServer().listen(Number(process.env.PORT??8081),process.env.REPORTS_EMULATOR==='true'?'127.0.0.1':'0.0.0.0');
