import type {IdentityCatalog,IdentityField,IdentitySeed,IdentityFieldChoice,ReportClientSettings,ReportIdentity,ReportPreset,ClientReportDraft} from './types.ts';
import {REPORT_PRESETS} from './presets.ts';
import {parseFixedModelText,mergeFixedModelText} from './fixed-text.ts';
export const IDENTITY_LABELS:Record<IdentityField,string>={clientDisplayName:'Cliente comercial',facilityName:'Unidade',requesterName:'Requerente',taxId:'CNPJ',address:'Endereço',responsibleName:'Responsável técnico',responsibleRegistration:'Registro técnico',postalCode:'CEP',city:'Cidade',state:'UF',phone:'Telefone',stateRegistration:'Inscrição estadual'};
export const emptyReportIdentity=()=>({clientDisplayName:'',facilityName:'',requesterName:'',taxId:'',address:'',responsibleName:'',responsibleRegistration:''});
export function buildDefaultMethodology(settings:ReportClientSettings|null,stationId:string):Pick<ClientReportDraft['narratives'],'methodology'|'methodologySource'>{
 const ref=settings?.references.find(r=>r.id===`unit-description:${stationId}`&&r.pointId===stationId&&r.approvedByUid&&r.source.trim()&&r.version.trim()&&r.application.trim());
 return ref?{methodology:ref.application,methodologySource:`${ref.source} (versão ${ref.version}; conferida por ${ref.approvedByUid})`}:{};
}
export function parseIdentityCatalog(text:string):IdentityCatalog{
  if(new TextEncoder().encode(text).length>2*1024*1024)throw new Error('Catálogo excede 2 MiB.');
  const c=JSON.parse(text) as IdentityCatalog;
  if(c.format!=='ouro-fino.report-identities'||c.version!==1||!Array.isArray(c.entries)||!c.entries.length||c.entries.length>8)throw new Error('Formato de catálogo inválido.');
  const seen=new Set<string>();
  for(const s of c.entries){const key=`${s.clientId}/${s.stationId}`;
    if(!REPORT_PRESETS.some(p=>p.clientId===s.clientId&&p.stationId===s.stationId)||seen.has(key))throw new Error('Vínculo desconhecido ou repetido.');seen.add(key);
    if(!s.source||typeof s.source.fileName!=='string'||!s.source.fileName.trim()||s.source.fileName.length>500||! /^[a-f0-9]{64}$/.test(s.source.sha256))throw new Error('Origem e SHA-256 são obrigatórios.');
    if(!s.identity||typeof s.identity!=='object'||Array.isArray(s.identity)||!Array.isArray(s.pendingFields)||s.pendingFields.some(f=>!Object.hasOwn(IDENTITY_LABELS,f)))throw new Error('Identificação inválida.');
    for(const [field,value] of Object.entries(s.identity))if(!Object.hasOwn(IDENTITY_LABELS,field)||typeof value!=='string'||value.length>2000)throw new Error('Campo cadastral inválido.');
    if(s.fixedText){s.fixedText=parseFixedModelText(s.fixedText);if(s.fixedText.source.fileName!==s.source.fileName||s.fixedText.source.sha256!==s.source.sha256)throw new Error('Origem do texto fixo não corresponde ao modelo.');}
    if(s.identity.taxId){const n=s.identity.taxId.replace(/\D/g,'');if(n.length!==14)throw new Error('CNPJ deve conter 14 dígitos.');s.identity.taxId=n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');}
  }return c;
}
export function compareIdentitySeed(settings:ReportClientSettings|null,seed:IdentitySeed):{field:IdentityField;current:string;incoming:string;status:'empty'|'same'|'conflict'}[]{
  if(settings&&settings.clientId!==seed.clientId)throw new Error('Cliente do catálogo não corresponde ao cadastro.');
  return (Object.keys(seed.identity) as IdentityField[]).map(field=>{const current=settings?.identities[seed.stationId]?.[field]??'',incoming=seed.identity[field]??'';return {field,current,incoming,status:current===incoming?'same':current.trim()?'conflict':'empty'};});
}
export function mergeIdentitySeed(settings:ReportClientSettings,seed:IdentitySeed,choices:IdentityFieldChoice[],actorUid:string,at:string,applyFixedText=false):ReportClientSettings{
  seed=parseIdentityCatalog(JSON.stringify({format:'ouro-fino.report-identities',version:1,entries:[seed]})).entries[0];
  if(!actorUid.trim()||!Number.isFinite(Date.parse(at)))throw new Error('Autor e data da importação obrigatórios.');
  const differences=compareIdentitySeed(settings,seed),fields=differences.filter(d=>choices.some(c=>c.field===d.field&&c.apply)&&d.status!=='same'&&d.incoming.trim()).map(d=>d.field);
  const prepared=applyFixedText&&seed.fixedText?mergeFixedModelText(settings,seed.stationId,seed.fixedText,actorUid):structuredClone(settings);
  if(!fields.length)return prepared;
  const next=prepared,identity={...emptyReportIdentity(),...next.identities[seed.stationId]};
  for(const field of fields)identity[field]=seed.identity[field]!;
  next.identities[seed.stationId]=identity;next.updatedByUid=actorUid;
  const entries=next.identitySources?.[seed.stationId]??[];
  if(entries.length>=10)throw new Error('Limite de dez importações por estação; revise as origens antes de continuar.');
  next.identitySources={...next.identitySources,[seed.stationId]:[...entries,{...seed.source,fields,importedByUid:actorUid,importedAt:at}]};return next;
}
export function buildDefaultPresentation(identity:ReportIdentity,preset:ReportPreset,period:string):string{
  return `Relatório de acompanhamento de ${identity.facilityName||'unidade a confirmar'}, ${preset.label}, referente à competência ${period.split('-').reverse().join('/')}. Cliente comercial: ${identity.clientDisplayName||'a confirmar'}. Requerente: ${identity.requesterName||'a confirmar'}. Apresenta resultados e controles do mês para avaliação pelo responsável técnico.`;
}
