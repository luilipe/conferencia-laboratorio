import {createReportDraft,REPORT_PRESETS} from '../../lib/client-reports/presets.ts';
import {parseReportValue as v} from '../../lib/client-reports/values.ts';

// Exclusivamente sintético; não representa operação, cadastro ou homologação reais.
export function demoDraft(preset,actorUid='reviewer-1'){
 const d=createReportDraft(preset.clientId,preset.stationId,'2026-09');d.id=`demo-${preset.clientId}-${preset.stationId}`;delete d.selection.labComparison;
 d.identity={clientDisplayName:preset.label,facilityName:'Unidade sintética para revisão de layout',requesterName:'Requerente sintético',taxId:'Não informado nesta demonstração',address:'Endereço sintético',responsibleName:'Revisor de demonstração',responsibleRegistration:'SEM VALIDADE TÉCNICA',issueDate:'2026-10-05'};
 d.narratives={presentation:'Demonstração sintética para conferência de apresentação, paginação e exportação. Os números não representam o desempenho de uma instalação real.',observations:'Sem fontes operacionais reais neste exemplo. Símbolos para inspeção: DBO₅ ≤ 2 µg/L; ≥ 3 mg/L; SS30; SS60; m³; µS/cm; °C. Eventos de entrega e consumo e leituras acumuladas permanecem separados.',conclusion:'Conclusão sintética destinada à revisão do modelo. A conclusão de um relatório real deve ser escrita e revisada pelo responsável técnico com base nas fontes da competência.'};
 if(preset.clientId==='demo13')d.selection.optionalChartIds=['demo13-DBO','demo13-DQO'];if(preset.clientId==='demo24')d.selection.optionalChartIds=['demo24-ph-esmaltacao','demo24-ph-polidora'];
 const source={id:`synthetic-${d.id}`,name:'DEMONSTRAÇÃO SINTÉTICA — sem validade operacional',sha256:'',kind:'manual',size:0,importedAt:'2026-10-05T12:00:00Z',importedByUid:actorUid,adapterVersion:'manual-v1'};
 const ref={sourceId:source.id,authorUid:actorUid,reason:'Exemplo sintético identificado para homologação de layout'};d.data.sources=[source];d.data.issues=[{id:'synthetic-demo',code:'synthetic-example',severity:'blocker',message:'Dados sintéticos: emissão operacional proibida.',recordIds:[],acknowledgedByUid:null,acknowledgement:null}];
 const points=preset.clientId==='demo01'?preset.points.filter(p=>p.id!=='tratado'):preset.points;
 for(const point of points)for(const parameter of (preset.clientId==='demo14'?['Cor','Fluoreto','Turbidez','Cloro','pH','E. coli']:['DBO','DQO'])){
   const raw=parameter==='E. coli'?'Ausência':parameter==='pH'?'7,10':parameter==='DBO'?(point.id==='bruto'||point.id==='equalizado'?'240,0':'5,07'):parameter==='DQO'?(point.id==='bruto'||point.id==='equalizado'?'600':'21'): '0,5';
   const unit=parameter==='pH'?'':parameter==='E. coli'?'UFC/100 mL':parameter==='Cor'?'uH':parameter==='Turbidez'?'NTU':'mg/L';const id=`lab-${point.id}-${parameter}`;
   d.data.lab.push({id,labId:preset.clientId==='demo01'?'LABORATORIOA (sintético)':preset.clientId==='demo02'?'Laboratoriob (sintético)':'MR (sintético)',sampleBase:`${point.id}-demo`,revision:1,sampleNumber:`DEMO-${point.id}.1`,stationId:preset.stationId,pointId:point.id,identification:point.label,company:'Solicitante sintético',date:'2026-09-02',time:'08:00',publicationDate:'2026-10-01',parameter,value:v(raw,unit),source:ref});
 }
 const inlet=points.find(p=>['bruto','equalizado'].includes(p.id)),outlet=points.find(p=>p.id===(preset.clientId==='demo01'?'decantador':'tratado'));
 if(inlet&&outlet&&preset.clientId!=='demo14')for(const parameter of ['DBO','DQO'])d.selection.efficiencyPairs.push({parameter,inletId:`lab-${inlet.id}-${parameter}`,outletId:`lab-${outlet.id}-${parameter}`,declaredId:null});
 d.narratives.methodology='Descrição sintética da unidade e do acompanhamento mensal, para revisão do formato.';d.narratives.methodologySource='Demonstração sintética — não descreve instalação real';
 const params=preset.clientId==='demo14'?['pH','Condutividade','Alcalinidade']:preset.clientId==='demo24'?['pH']:['pH','Temperatura','SS30','SS60',...(preset.clientId==='demo08'?['Cloro','Condutividade']:[])];
 for(let day=1;day<=26;day++)for(const point of preset.points)for(const parameter of params)for(const shift of (preset.clientId==='demo08'?['manhã','tarde']:['diurno'])){
   if(day===13)continue;const id=`op-${day}-${point.id}-${parameter}-${shift}`;const raw=parameter==='pH'?String(7+(day%5)/10).replace('.',','):parameter==='Temperatura'?'23,4':parameter==='Cloro'?'0,5':parameter==='Condutividade'?'850':String(day%4+1);const unit=parameter==='pH'?'':parameter==='Temperatura'?'°C':parameter.startsWith('SS')?'mL/L':parameter==='Cloro'?'mg/L':parameter==='Condutividade'?'µS/cm':parameter==='Alcalinidade'?'mg/L':'NTU';
   d.data.operations.push({id,stationId:preset.stationId,pointId:point.id,date:`2026-09-${String(day).padStart(2,'0')}`,time:shift==='tarde'?'14:00':'08:00',shift,treatment:preset.clientId==='demo24'?`Tratamento ${day}`:null,parameter,value:v(raw,unit),source:ref});
 }
 if(preset.clientId==='demo24'){d.data.operations=[];for(let i=0;i<274;i++)d.data.operations.push({id:`demo24-${i}`,stationId:'combined',pointId:i<141?'esmaltacao':'polidora',date:`2026-09-${String(i%26+1).padStart(2,'0')}`,time:i%2?'14:00':'08:00',shift:null,treatment:String(Math.floor(i/26)+1),parameter:'pH',value:v(String(7+(i%5)/10).replace('.',','),''),source:ref});}
 const meterIds=preset.clientId==='demo01'?['sanitario','tratado','equalizado']:['entrada'];
 for(const meterId of meterIds){d.selection.meterBaselines[meterId]={id:`base-${meterId}`,meterId,date:'2026-08-31',time:'08:00',cumulative:v('100','m³'),declaredIntervalVolume:null,source:ref};for(const day of [1,5,10,15,20,26])d.data.meters.push({id:`meter-${meterId}-${day}`,meterId,date:`2026-09-${String(day).padStart(2,'0')}`,time:'08:00',cumulative:v(String(100+day*3),'m³'),declaredIntervalVolume:null,source:ref});}
 for(const [i,kind,unit,product] of [[0,'delivery','IBC','PAC'],[1,'consumption','L','PAC'],[2,'consumption','kg','Cal'],[3,'delivery','saco','Cal'],[4,'consumption','prensa','Lodo']])d.data.supplies.push({id:`supply-${i}`,stationId:preset.stationId,date:'2026-09-02',kind,product,quantity:v('2',unit),source:ref});
 d.data.journal=Array.from({length:preset.clientId==='demo01'?520:3},(_,i)=>({id:`journal-${i}`,date:`2026-09-${String(Math.floor(i/20)+1).padStart(2,'0')}`,shift:i%2?'noturno':'diurno',order:i%20+1,text:`Observação sintética ${i+1}. Conferência das rotinas, parada programada e registro manual; sem extração automática de quantidades desta descrição.`,plantState:i===2?'off':'unknown',source:ref}));
 return d;
}
export const demoDrafts=(uid)=>REPORT_PRESETS.map(p=>demoDraft(p,uid));
