import type {ReportPreset,ReportClientId,ReportChartDefinition} from './types.ts';
const chart=(id:string,title:string,source:ReportChartDefinition['source'],parameter:string,unit:string|null,pointIds:string[],optional=false):ReportChartDefinition=>({id,title,source,parameter,unit,pointIds,optional,kind:source==='laboratory'?'line':'bar'});
const pointLabels:Record<string,string>={
  bruto:'Bruto / Equalizado',
  tratado:'Tratado',
  esmaltacao:'Esmaltação',
  polidora:'Polidora',
  poco:'Poço Tubular / Subterrâneo',
  consumo:'Ponto de Consumo',
  saida:'Saída do Tratamento',
  'elevatoria-3':'Elevatória 3',
  'decantador-1':'Decantador 01',
  'decantador-2':'Decantador 02',
  equalizado:'Equalizado',
  anaerobio:'Tanque Anaeróbio (correspondência a confirmar)',
  elevatoria:'Elevatória',
  'reator-1':'Reator 1',
  'reator-2':'Reator 2',
  decantador:'Decantador',
  lancamento:'Lançamento',
  biologico:'Biológico',
  sedipack:'Sedipack'
};
const order=['presentation','objective','identity','methodology','laboratory','efficiency','history','operations','statistics','meters','supplies','journal','observations','conclusion','bibliography','sources'];
function model(clientId:ReportClientId,stationId:string,label:string,ids:string[],parameters:string[],required:string[],charts:ReportChartDefinition[],sourceBlocks:Record<string,string[]>):ReportPreset{
 return {clientId,stationId,label,version:'2',enabled:false,points:ids.map(id=>({id,label:pointLabels[id]||id})),parameters,requiredSections:['presentation','objective','identity','methodology',...required,'conclusion','sources'],optionalSections:order.filter(id=>!['presentation','objective','identity','methodology',...required,'conclusion','sources'].includes(id)),requiredSources:required.includes('laboratory')?['laboratory']:['operations'],sectionOrder:clientId==='demo01'?['presentation','objective','identity','methodology','journal','supplies','laboratory','efficiency','operations','statistics','meters','history','observations','conclusion','bibliography','sources']:order,chartDefinitions:charts,sourceBlocks};
}
const organic=(prefix:string,points:string[],optional=true)=>['DBO','DQO'].map(p=>chart(`${prefix}-${p}`,`${p} — comparação por ponto${optional?' (extensão opcional)':''}`,'laboratory',p,'mg/L',points,optional));
const efficiencies=()=>['DBO','DQO'].map(p=>chart(`efficiency-${p}`,`Eficiência ${p}: calculada e declarada`,'efficiency',p,'%',[]));
export const REPORT_TEMPLATES_V2:ReportPreset[]=[
 model('demo13','etdi','DEMO13 — ETDI',['bruto','tratado'],['DBO','DQO'],['laboratory'],[...organic('demo13',['bruto','tratado'],true),...efficiencies()],{identity:['block-72','block-78'],laboratory:['block-87','block-91','block-97'],supplies:['block-99']}),
 model('demo13','biologico','DEMO13 — Biológico',['bruto','tratado'],['DBO','DQO'],['laboratory'],[...organic('demo13',['bruto','tratado'],true),...efficiencies()],{identity:['block-72','block-74'],laboratory:['block-83','block-87','block-92'],supplies:['block-93']}),
 model('demo24','combined','Demo24 — Esmaltação e Polidora',['esmaltacao','polidora'],['pH'],['operations','supplies'],['esmaltacao','polidora'].map(p=>chart(`demo24-ph-${p}`,`pH ${pointLabels[p]}`,'operations','pH','',[p],false)),{identity:['block-76','block-78'],operations:['block-98','block-101'],methodology:['block-113']}),
 model('demo08','ete','2N — Hospital',['elevatoria-3','decantador-1','decantador-2','equalizado','anaerobio','tratado'],['pH','SS30','SS60','Cloro','Condutividade'],['laboratory','operations'],[
 chart('hospital-ph-biologico','pH Biológico','operations','pH','',['equalizado','anaerobio']),chart('hospital-ph-tratamento','pH Tratamento biológico','operations','pH','',['elevatoria-3','decantador-1','decantador-2']),chart('hospital-ph-saida','pH Saída','operations','pH','',['tratado']),chart('hospital-ss60','Sólidos sedimentáveis 60 minutos','operations','SS60','mL/L',['elevatoria-3','decantador-1','decantador-2']),chart('hospital-ss30','Sólidos sedimentáveis 30 minutos','operations','SS30','mL/L',['elevatoria-3','equalizado']),chart('hospital-cloro','Cloro Saída','operations','Cloro',null,['tratado']),chart('hospital-condutividade','Condutividade','operations','Condutividade',null,['elevatoria-3','anaerobio','tratado'])],{identity:['block-73','block-75'],operations:['block-84','block-102','block-108','block-118','block-124'],laboratory:['block-136']}),
 model('demo09','ete','Demo09 — Efluente',['elevatoria','reator-1','reator-2','decantador','lancamento','bruto','tratado'],['DBO','DQO'],['laboratory','operations','efficiency'],[...organic('demo09',['bruto','tratado'],false),...efficiencies()],{laboratory:['visible:Plan1'],operations:['visible:Mensal']}),
 model('demo14','eta','Demo14 Ipê — ETA',['bruto','tratado'],['pH','Condutividade','Alcalinidade'],['laboratory','meters'],[chart('demo14-ph','pH','operations','pH','',['tratado']),chart('demo14-condutividade','Condutividade','operations','Condutividade',null,['tratado']),chart('demo14-alcalinidade','Alcalinidade','operations','Alcalinidade',null,['tratado']),...organic('demo14',['bruto','tratado'],true)],{identity:['block-72','block-74'],laboratory:['block-84','block-86','block-88','block-90','block-92'],meters:['block-104']}),
 model('demo02','ete','Demo02 Grupo ficticio — ETE',['bruto','reator-1','reator-2','tratado'],['DBO','DQO'],['laboratory','operations','supplies'],[...organic('demo02',['bruto','tratado'],true),...efficiencies(),chart('demo02-ph-reatores','pH Reatores biológicos','operations','pH','',['reator-1','reator-2']),chart('demo02-ph-tratado','pH Tratado','operations','pH','',['tratado']),...['SS60','SS30'].map(p=>chart(`demo02-${p}`,`${p} — reatores e tratado`,'operations',p,'mL/L',['reator-1','reator-2','tratado'],true))],{identity:['block-72','block-74'],laboratory:['block-85'],supplies:['block-88','block-91'],operations:['block-96','block-104','block-110']}),
 model('demo01','ete','Demo01 Química — ETE',['equalizado','biologico','sedipack','decantador','tratado'],['DBO','DQO'],['laboratory','operations','meters','supplies','journal'],[...organic('demo01',['equalizado','biologico','sedipack','decantador'],false),...efficiencies(),chart('demo01-ph-tratado','pH Tratado','operations','pH','',['tratado']),chart('demo01-ph-points','pH Equalizado / Sedipack / Biológico','operations','pH','',['equalizado','sedipack','biologico']),chart('demo01-ss60','Sólidos sedimentáveis 60 minutos','operations','SS60','mL/L',['biologico','tratado']),chart('demo01-volumes','Volumes comprovados por intervalo — hidrômetros','meters','Volume','m³',['sanitario','tratado','equalizado'])],{identity:['block-73','block-75'],laboratory:['block-675','block-677','block-681','block-683','block-685'],operations:['block-693','block-700'],meters:['block-705','block-707'],journal:['block-79:block-661'],supplies:['block-662:block-670']})
];
export function getReportTemplate(clientId:ReportClientId,stationId:string):ReportPreset{
  const p=REPORT_TEMPLATES_V2.find(p=>p.clientId===clientId&&p.stationId===stationId);
  if(p)return structuredClone(p);

  const cleanClient = String(clientId).toLowerCase();
  const cleanStation = String(stationId).toLowerCase();

  // Model E: Polidora
  if (cleanClient.includes('polidor') || cleanStation.includes('polidor') || ['demo23', 'demo25', 'demo26', 'demo27'].includes(cleanClient)) {
    return model(clientId, stationId, `${cleanClient.toUpperCase()} — Polidora`, ['polidora', 'tratado'], ['pH'], ['operations'], [chart(`${cleanClient}-ph`, 'pH Polidora', 'operations', 'pH', '', ['polidora', 'tratado'], false)], {});
  }

  // Model D: Água tratada e subterrânea
  if (cleanStation.includes('poco') || cleanStation.includes('eta') || ['demo15', 'demo16', 'demo17', 'demo18', 'demo19', 'demo20', 'demo21', 'demo22'].includes(cleanClient)) {
    return model(clientId, stationId, `${cleanClient.toUpperCase()} — Água Tratada e Subterrânea`, ['poco', 'tratado', 'consumo'], ['pH', 'Turbidez', 'Cloro'], ['laboratory'], [chart(`${cleanClient}-ph`, 'pH Água', 'operations', 'pH', '', ['poco', 'tratado'], false)], {});
  }

  // Model B: ETE Sanitária / Biológico
  if (cleanStation.includes('bio') || cleanStation.includes('sanit')) {
    return model(clientId, stationId, `${cleanClient.toUpperCase()} — ETE Sanitária`, ['bruto', 'tratado'], ['DBO', 'DQO'], ['laboratory'], [...organic(cleanClient, ['bruto', 'tratado'], true), ...efficiencies()], {});
  }

  // Model C: ETDI
  if (cleanStation.includes('etdi')) {
    return model(clientId, stationId, `${cleanClient.toUpperCase()} — ETDI`, ['bruto', 'tratado'], ['DBO', 'DQO'], ['laboratory'], [...organic(cleanClient, ['bruto', 'tratado'], true), ...efficiencies()], {});
  }

  // Default: Model A (ETE Industrial)
  return model(clientId, stationId, `${cleanClient.toUpperCase()} — ETE Industrial`, ['bruto', 'tratado'], ['DBO', 'DQO'], ['laboratory'], [...organic(cleanClient, ['bruto', 'tratado'], true), ...efficiencies()], {});
}
