import type {NarrativeContext,NarrativeSuggestion,ReportClientSettings} from '../../lib/client-reports/types.ts';
import {validateNarrativeSuggestion} from '../../lib/client-reports/narrative-review.ts';
export async function generateNarrativeForContext(context:NarrativeContext,call:(context:NarrativeContext)=>Promise<unknown>):Promise<NarrativeSuggestion>{
 if(!context.evidence.some(e=>['result','event','calculation'].includes(e.kind)))throw new Error('Importe e confira resultados ou registros atuais antes de gerar a sugestão.');
 return validateNarrativeSuggestion(await call(context),context);
}
export function assertTechnicalApprover(uid:string,settings:Pick<ReportClientSettings,'technicalApproverUid'>){if(!settings.technicalApproverUid||uid!==settings.technicalApproverUid)throw new Error('Aprovação permitida somente ao responsável técnico configurado.');}
