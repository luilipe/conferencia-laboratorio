import type {ClientReportDraft,ReportDocument,SerializedSnapshot} from './types.ts';
export function canonicalReportJson(value:unknown):string{const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):v;return JSON.stringify(ordered(value));}
export function assertSnapshotRenderer(snapshot:{draft:Pick<ClientReportDraft,'documentRendererVersion'>;document:Pick<ReportDocument,'rendererVersion'>},metadataRenderer:string):void{
 const version=snapshot.document.rendererVersion,selected=snapshot.draft.documentRendererVersion;
 if(!['1','2','3','4'].includes(version)||version!==metadataRenderer||(selected?version!==selected:!['1','2'].includes(version)))throw new Error('Renderizador do conteúdo diverge da versão salva.');
}
export const MAX_REPORT_CHUNK_BYTES=200*1024;
export async function reportSha256(text:string):Promise<string>{const bytes=new TextEncoder().encode(text);const digest=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");}
export async function serializeReportSnapshot(snapshot:{draft:ClientReportDraft;document:ReportDocument}):Promise<SerializedSnapshot>{
  const text=JSON.stringify(snapshot),encoder=new TextEncoder(),payloads:string[]=[];let payload="",bytes=0;
  for(const char of text){const length=char.codePointAt(0)!<128?1:encoder.encode(char).length;if(bytes+length>MAX_REPORT_CHUNK_BYTES){payloads.push(payload);payload="";bytes=0;}payload+=char;bytes+=length;}
  if(payload)payloads.push(payload);
  return {chunks:await Promise.all(payloads.map(async(payload,sequence)=>({sequence,payload,sha256:await reportSha256(payload)}))),sha256:await reportSha256(text),totalBytes:encoder.encode(text).length};
}
export async function deserializeReportSnapshot(serialized:SerializedSnapshot):Promise<{draft:ClientReportDraft;document:ReportDocument}>{
  const chunks=[...serialized.chunks].sort((a,b)=>a.sequence-b.sequence);if(!chunks.length)throw new Error("Conteúdo sem partes.");
  for(let i=0;i<chunks.length;i++){const c=chunks[i];if(c.sequence!==i)throw new Error("Parte ausente ou sequência repetida.");if(new TextEncoder().encode(c.payload).length>MAX_REPORT_CHUNK_BYTES||await reportSha256(c.payload)!==c.sha256)throw new Error("Integridade de uma parte divergente.");}
  const text=chunks.map(c=>c.payload).join("");if(new TextEncoder().encode(text).length!==serialized.totalBytes||await reportSha256(text)!==serialized.sha256)throw new Error("Integridade do relatório divergente.");
  const value=JSON.parse(text) as {draft:ClientReportDraft;document:ReportDocument};
  if(!value.draft?.id||!value.draft.data||!value.draft.selection||!value.draft.identity||!value.draft.narratives||!Array.isArray(value.document?.sections)||value.draft.id!==value.document.id||value.draft.clientId!==value.document.clientId||value.draft.stationId!==value.document.stationId||value.draft.period!==value.document.period||value.draft.revision!==value.document.revision)throw new Error("Estrutura ou identificação do relatório inválida.");
  return value;
}
