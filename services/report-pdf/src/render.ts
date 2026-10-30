import {chromium,type Browser} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ReportDocument} from '../../../lib/client-reports/types.ts';
import {renderReportHtml} from '../../../lib/client-reports/report-html.ts';
export async function renderReportPdf(document:ReportDocument,providedBrowser?:Browser):Promise<Buffer>{
 const bundled=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'report-assets'),dir=fs.existsSync(bundled)?bundled:path.resolve('public/report-assets');
 const data=(name:string,mime:string)=>`data:${mime};base64,${fs.readFileSync(path.join(dir,name)).toString('base64')}`;
 const systemChrome=process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'';
 const executablePath=process.env.REPORTS_CHROMIUM_PATH||(systemChrome&&fs.existsSync(systemChrome)?systemChrome:undefined);
 const browser=providedBrowser??await chromium.launch({headless:true,executablePath});
 const context=await browser.newContext({javaScriptEnabled:false});let timer:ReturnType<typeof setTimeout>|undefined;
 try{const page=await context.newPage();page.setDefaultTimeout(30000);await page.route('**/*',route=>route.abort());
  await page.setContent(renderReportHtml(document,{logoDataUrl:data('ouro-fino-v1.png','image/png'),regularFontDataUrl:data('NotoSans-Regular.ttf','font/ttf'),boldFontDataUrl:data('NotoSans-Bold.ttf','font/ttf'),mathFontDataUrl:data('NotoSansMath-Regular.ttf','font/ttf')}),{waitUntil:'load'});
  await page.evaluate(()=>globalThis.document.fonts.ready);await page.emulateMedia({media:'print'});
  return await Promise.race([page.pdf({printBackground:true,preferCSSPageSize:true,tagged:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('O relatório excedeu o tempo de renderização PDF.')),45000);})]);
 }finally{clearTimeout(timer);await context.close();if(!providedBrowser)await browser.close();}
}
