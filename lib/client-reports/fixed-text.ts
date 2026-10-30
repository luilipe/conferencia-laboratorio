import type {ClientReportDraft,FixedModelText,ReportClientSettings,ReferenceRule} from './types.ts';
const SECTION_IDS=new Set(['presentation','technical-introduction','objective','methodology','operations','laboratory','bibliography']);
export function parseFixedModelText(value:unknown):FixedModelText{
 const v=value as FixedModelText;
 if(!v||typeof v!=='object'||!v.source||typeof v.source.fileName!=='string'||!v.source.fileName.trim()||!/^[a-f0-9]{64}$/.test(v.source.sha256)||!Array.isArray(v.sections)||!v.sections.length||v.sections.length>SECTION_IDS.size||JSON.stringify(v).length>150000)throw new Error('Texto fixo sem origem válida ou acima do limite.');
 const seen=new Set<string>();
 if(v.monthlySections&&(!Array.isArray(v.monthlySections)||v.monthlySections.some(s=>!['laboratory','operations','meters','supplies','journal','efficiency'].includes(s))))throw new Error('Seções mensais inválidas.');
 if(v.monthlyRequirements&&(!v.monthlyRequirements||typeof v.monthlyRequirements!=='object'||Array.isArray(v.monthlyRequirements)||Object.entries(v.monthlyRequirements).some(([k,val])=>!['laboratory','operations','meters','supplies','journal','efficiency'].includes(k)||!['required','conditional'].includes(val as string))))throw new Error('Requisitos mensais de seções inválidos.');
 if(v.laboratoryTables&&(!Array.isArray(v.laboratoryTables)||v.laboratoryTables.length>2||v.laboratoryTables.some(t=>!['bruto','tratado'].includes(t.pointId)||typeof t.title!=='string'||t.title.length>200||!Array.isArray(t.columns)||t.columns.length<2||t.columns.length>5||!Array.isArray(t.rows)||t.rows.length>100||t.rows.some(r=>r.length!==t.columns.length||r.some(c=>typeof c!=='string'||c.length>500)))))throw new Error('Estrutura dos quadros originais inválida.');
 if(v.layout?.cover&&(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v.layout.cover.clientLogo)||v.layout.cover.clientLogo.length>25000||v.layout.cover.monthMarker!=='period-month'||v.layout.cover.yearMarker!=='period-year'))throw new Error('Capa do modelo inválida.');
 if(v.layout){const l=v.layout;if(l.font!=='Arial'||!Number.isFinite(l.bodySize)||l.bodySize<16||l.bodySize>36||typeof l.coverTitle!=='string'||l.coverTitle.length>500||!Array.isArray(l.footer)||l.footer.some(t=>typeof t!=='string'||t.length>1000)||!l.margins||Object.values(l.margins).some(n=>!Number.isFinite(n)||n<300||n>3000))throw new Error('Estilos do modelo inválidos.');if(l.titleLines&&(!Array.isArray(l.titleLines)||l.titleLines.some(t=>typeof t!=='string'||t.length>200)))throw new Error('Títulos de modelo inválidos.');if(l.issuePlace&&typeof l.issuePlace!=='string')throw new Error('Local de emissão inválido.');}
 for(const s of v.sections){if(!s||!SECTION_IDS.has(s.id)||seen.has(s.id)||typeof s.title!=='string'||!s.title.trim()||s.title.length>200||!Array.isArray(s.paragraphs)||!s.paragraphs.length||s.paragraphs.some(p=>typeof p!=='string'||!p.trim()||p.length>20000)||s.blockIds!==undefined&&(!Array.isArray(s.blockIds)||s.blockIds.some(b=>typeof b!=='string'||!/^block-\d+$/.test(b))))throw new Error('Seção fixa inválida; resultados, diário e conclusão não pertencem ao modelo fixo.');seen.add(s.id);}
 return structuredClone(v);
}
export function mergeFixedModelText(settings:ReportClientSettings,stationId:string,value:FixedModelText,actorUid:string):ReportClientSettings{
 if(!actorUid.trim())throw new Error('Informe o responsável pelo cadastro do modelo.');
 const fixed=parseFixedModelText(value),id=`fixed-model:${stationId}`;
 const reference:ReferenceRule={id,parameter:'Textos fixos do modelo',pointId:stationId,unit:'',min:null,max:null,source:fixed.source.fileName,version:fixed.source.sha256,application:JSON.stringify(fixed),approvedByUid:actorUid};
 if(settings.references.some(r=>JSON.stringify(r)===JSON.stringify(reference)))return structuredClone(settings);
 return {...structuredClone(settings),updatedByUid:actorUid,references:[...settings.references.filter(r=>r.id!==id),reference]};
}
export function applyFixedModelText(draft:ClientReportDraft,settings:ReportClientSettings|null):ClientReportDraft{
 if(draft.presetVersion!=='2'||settings?.clientId!==draft.clientId)return structuredClone(draft);
 const ref=settings.references.find(r=>r.id===`fixed-model:${draft.stationId}`&&r.pointId===draft.stationId&&r.approvedByUid);
 if(!ref)return structuredClone(draft);
 const fixed=parseFixedModelText(JSON.parse(ref.application));
 if(fixed.source.fileName!==ref.source||fixed.source.sha256!==ref.version)throw new Error('A origem do texto fixo diverge do cadastro.');
 const next=structuredClone(draft),text=(id:string)=>fixed.sections.find(s=>s.id===id)?.paragraphs.join('\n\n');
 next.fixedText=fixed;
 if(text('presentation'))next.narratives.presentation=text('presentation')!;
 if(text('methodology')){next.narratives.methodology=text('methodology');next.narratives.methodologySource=fixed.source.fileName;}
 return next;
}
