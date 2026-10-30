import type {ReportChart} from './types.ts';
import {prepareReportChart} from './charts.ts';
import {REPORT_BRAND_V1 as brand} from './branding.ts';
import {formatReportNumber} from './values.ts';

const colors = ['#214632', '#C89D35', '#2B5B84', '#A84A42', '#4A6B82', '#7A4C91', '#007E86', '#616161'];

export function reportSeriesColor(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes('limite') || lower.includes('padrão') || lower.includes('padrao') || lower.includes('conama')) {
    return '#B91C1C';
  }
  if (lower.includes('bruto') || lower.includes('entrada') || lower.includes('inlet')) {
    return '#C89D35'; // Ouro Fino gold accent
  }
  if (lower.includes('tratado') || lower.includes('saida') || lower.includes('saída') || lower.includes('outlet')) {
    return '#214632'; // Ouro Fino institutional green
  }
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

export function renderReportChartV2(chart:ReportChart,prepared=prepareReportChart(chart)):string{
 if(typeof document==='undefined')return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
 const canvas=document.createElement('canvas');canvas.width=brand.chartWidth;canvas.height=brand.chartHeight;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Gráfico indisponível.');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 const wrap=(text:string,width:number)=>{const lines:string[]=[];let line='';for(const word of text.split(/\s+/)){if(ctx.measureText((line+' '+word).trim()).width>width&&line){lines.push(line);line=word;}else line=(line+' '+word).trim();}if(line)lines.push(line);return lines;};
 ctx.font='bold 34px Arial';const titles=wrap(chart.title,1920);ctx.fillStyle=brand.deepGreen;titles.forEach((line,i)=>ctx.fillText(line,70,50+i*42));
 ctx.font='24px Arial';const legend: {x:number;y:number;lines:string[];id:string;label:string}[]=[];let lx=90,ly=0,rowHeight=0;
 for(const s of prepared.series){const lines=wrap(s.label,490),w=Math.min(550,Math.max(...lines.map(l=>ctx.measureText(l).width))+60);if(lx+w>2000){lx=90;ly+=rowHeight;rowHeight=0;}legend.push({x:lx,y:ly,lines,id:s.id,label:s.label});lx+=w+30;rowHeight=Math.max(rowHeight,lines.length*30+18);}
 const legendHeight=ly+Math.max(60,...legend.map(s=>s.lines.length*30+12));
 const top=50+titles.length*42+32,bottom=900-legendHeight-135,right=2010;
 ctx.font='23px Arial';const tickLabels=Array.from({length:5},(_,i)=>formatReportNumber(prepared.min+(prepared.max-prepared.min)*i/4));
 const left=Math.max(110,...tickLabels.map(t=>ctx.measureText(t).width+32));
 if(bottom-top<200)throw new Error('Legenda excede o espaço do gráfico; reduza séries ou nomes antes de emitir.');
 const positions=prepared.slots.map(s=>s.position),low=Math.min(...positions),high=Math.max(...positions),span=high-low||1;
 const x=(i:number)=>prepared.kind==='bar'&&prepared.xMode==='category'?left+(i+.5)/Math.max(1,prepared.slots.length)*(right-left):prepared.slots.length===1?(left+right)/2:left+(positions[i]-low)/span*(right-left);
 const y=(n:number)=>bottom-(n-prepared.min)/(prepared.max-prepared.min)*(bottom-top);
 for(let i=0;i<5;i++){const value=prepared.min+(prepared.max-prepared.min)*i/4;ctx.strokeStyle='#DFE6DF';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(right,y(value));ctx.stroke();ctx.fillStyle='#47594D';ctx.textAlign='right';ctx.fillText(tickLabels[i],left-20,y(value)+7);}ctx.textAlign='left';
 ctx.fillText(chart.unit||'Adimensional / unidade a confirmar',left,top-14);
 const active=prepared.series.filter(s=>!s.reference),barWidth=Math.min(70,(right-left)/Math.max(1,prepared.slots.length)/Math.max(1,active.length)*.8);
 const ids=prepared.series.map(s=>s.id).sort();
 const dash=(id:string,reference=false)=>reference?[12,8]:[[],[16,8],[4,7]][Math.floor(ids.indexOf(id)/3)%3];
 const marker=(id:string,xx:number,yy:number)=>{ctx.beginPath();const shape=ids.indexOf(id)%3;if(shape===0)ctx.arc(xx,yy,6,0,Math.PI*2);else if(shape===1)ctx.rect(xx-6,yy-6,12,12);else{ctx.moveTo(xx,yy-8);ctx.lineTo(xx+8,yy+6);ctx.lineTo(xx-8,yy+6);ctx.closePath();}ctx.fill();ctx.save();ctx.strokeStyle='#FFFFFF';ctx.lineWidth=2;ctx.setLineDash([]);ctx.stroke();ctx.restore();};
 prepared.series.forEach(s=>{const color=reportSeriesColor(s.id);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=4;ctx.setLineDash(dash(s.id,s.reference));
  if(prepared.kind==='bar'&&!s.reference){const index=active.indexOf(s);s.values.forEach((value,i)=>{if(value===null)return;const bx=x(i)+(index-(active.length-1)/2)*barWidth,yy=y(value),base=y(0);ctx.fillRect(bx-barWidth*.45,Math.min(base,yy),barWidth*.9,Math.max(2,Math.abs(base-yy)));ctx.strokeRect(bx-barWidth*.45,Math.min(base,yy),barWidth*.9,Math.max(2,Math.abs(base-yy)));marker(s.id,bx,yy);});}
  else {let connected=false;ctx.beginPath();s.values.forEach((value,i)=>{if(value===null){connected=false;return;}if(connected)ctx.lineTo(x(i),y(value));else ctx.moveTo(x(i),y(value));connected=true;});ctx.stroke();s.values.forEach((value,i)=>{if(value===null||s.reference)return;marker(s.id,x(i),y(value));});}
 });ctx.setLineDash([]);
 ctx.font='20px Arial';ctx.fillStyle='#47594D';const n=prepared.slots.length;const step=Math.max(1,Math.ceil(n/7));for(let i=0;i<n;i+=step){const lines=wrap(prepared.slots[i].label,245);lines.slice(0,3).forEach((l,j)=>ctx.fillText(l,Math.max(left,Math.min(right-245,x(i)-100)),bottom+32+j*25));}
 ctx.font='24px Arial';for(const s of legend){const yy=900-legendHeight+s.y+11;ctx.strokeStyle=reportSeriesColor(s.id);ctx.fillStyle=reportSeriesColor(s.id);ctx.setLineDash(dash(s.id,prepared.series.find(series=>series.id===s.id)?.reference));ctx.beginPath();ctx.moveTo(s.x-4,yy);ctx.lineTo(s.x+26,yy);ctx.stroke();marker(s.id,s.x+11,yy);ctx.setLineDash([]);ctx.fillStyle=brand.deepGreen;s.lines.forEach((l,j)=>ctx.fillText(l,s.x+34,900-legendHeight+s.y+21+j*30));}
 if(!prepared.series.some(s=>s.values.some(v=>v!==null))){ctx.fillStyle=brand.deepGreen;ctx.font='28px Arial';ctx.fillText('Sem dados numéricos selecionados — fontes pendentes',left+100,(top+bottom)/2);}
 return canvas.toDataURL('image/png');
}
