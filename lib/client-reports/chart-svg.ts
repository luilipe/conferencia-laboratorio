import type {ReportChart} from './types.ts';
import {prepareReportChart} from './charts.ts';
import {reportSeriesColor} from './chart-renderer.ts';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderReportChartSvg(chart:ReportChart):string{
 const p=prepareReportChart(chart),w=1000,h=440,left=72,right=24,top=24,bottom=105,cw=w-left-right,ch=h-top-bottom;
 const first=p.slots[0]?.position??0,last=p.slots.at(-1)?.position??first+1;
 const x=(i:number)=>left+(p.slots.length===1?cw/2:(p.slots[i].position-first)/(last-first||1)*cw),y=(v:number)=>top+(p.max-v)/(p.max-p.min)*ch;
 let out=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(chart.title)}"><title>${esc(chart.title)} — ${esc(chart.unit)}</title><rect width="1000" height="440" fill="white"/>`;
 for(let i=0;i<=4;i++){const value=p.min+(p.max-p.min)*i/4,yy=y(value);out+=`<line x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}" stroke="#d9e3dd"/><text x="${left-8}" y="${yy+4}" text-anchor="end" font-size="12" fill="#52665b">${esc(value.toLocaleString('pt-BR',{maximumFractionDigits:2}))}</text>`;}
 p.slots.forEach((s,i)=>{if(i%Math.max(1,Math.ceil(p.slots.length/8))===0)out+=`<text x="${x(i)}" y="${top+ch+22}" text-anchor="middle" font-size="11" fill="#52665b">${esc(s.label.slice(0,22))}</text>`;});
 p.series.forEach((s,si)=>{const color=reportSeriesColor(s.id);let segment:string[]=[];const flush=()=>{if(segment.length>1)out+=`<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"${s.reference?' stroke-dasharray="6 4"':''}/>`;segment=[];};
  s.values.forEach((v,i)=>{if(v===null){flush();return;}if(p.kind==='bar'&&!s.reference){const bw=Math.max(1,Math.min(24,cw/Math.max(1,p.slots.length)/Math.max(1,p.series.length)*.65)),xx=x(i)+(si-(p.series.length-1)/2)*bw;out+=`<rect x="${xx-bw/2}" y="${Math.min(y(v),y(0))}" width="${bw}" height="${Math.max(1,Math.abs(y(v)-y(0)))}" fill="${color}"><title>${esc(s.label)}: ${v}</title></rect>`;}else{segment.push(`${x(i)},${y(v)}`);out+=`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${color}"><title>${esc(s.label)}: ${v}</title></circle>`;}});flush();
  out+=`<text x="${left+(si%3)*300}" y="${h-50+Math.floor(si/3)*18}" font-size="12" fill="${color}">${esc(s.label.slice(0,43))}</text>`;
 });return out+`<text x="${left}" y="${h-8}" font-size="11" fill="#52665b">${esc(chart.unit)} · Lacunas representam ausência de medição; dados completos no anexo.</text></svg>`;
}
