"use client";
import {useEffect,useState} from 'react';
import type {ReportDocument} from '@/lib/client-reports/types';
import {renderReportHtml,type ReportHtmlAssets} from '@/lib/client-reports/report-html';
export function ModernReportPreview({document:content}:{document:ReportDocument}){
 const [assets,setAssets]=useState<ReportHtmlAssets>({}),[error,setError]=useState('');
 useEffect(()=>{let alive=true;const load=async(path:string,mime:string)=>{const r=await fetch(path);if(!r.ok)throw new Error('Não foi possível carregar a identidade visual.');const bytes=new Uint8Array(await r.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return `data:${mime};base64,${btoa(binary)}`;};void Promise.all([load('/report-assets/ouro-fino-v1.png','image/png'),load('/report-assets/NotoSans-Regular.ttf','font/ttf'),load('/report-assets/NotoSans-Bold.ttf','font/ttf'),load('/report-assets/NotoSansMath-Regular.ttf','font/ttf')]).then(([logoDataUrl,regularFontDataUrl,boldFontDataUrl,mathFontDataUrl])=>{if(alive)setAssets({logoDataUrl,regularFontDataUrl,boldFontDataUrl,mathFontDataUrl});}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
 return <section><h2>Relatório para o cliente</h2><p>A prévia apresenta o conteúdo completo. Confira o PDF gerado para verificar a paginação final.</p>{error&&<p role="alert">{error}</p>}<iframe title="Prévia do relatório moderno" sandbox="" srcDoc={renderReportHtml(content,assets)} style={{width:'100%',height:'80vh',minHeight:600,border:'1px solid #d9e3dd',borderRadius:12,background:'#fff'}}/></section>;
}
