import {parseReportValue,normalizeUnit} from './values.ts';

/** Word run spacing and Excel numeric storage are transcription details; raw stays intact. */
export function parseModelReportValue(raw:string,originalUnit:string,excel=false){
 const compact=raw.replace(/\s+/g,''),u=originalUnit.replace(/\s+/g,'');
 const aliases:Record<string,string>={'mgO2/L':'mg/L','Mg/L':'mg/L','ug/l':'µg/L','ug/L':'µg/L','ml/L':'mL/L','------':''};
 const unit=normalizeUnit(aliases[u]??u);
 const input=excel&&/^[+-]?\d+(?:\.\d+)?(?:E[+-]?\d+)?$/i.test(compact)?Number(compact):compact;
 return {...parseReportValue(input,unit,{decimalMode:'pt-BR',allowThousands:true}),raw,originalUnit};
}
