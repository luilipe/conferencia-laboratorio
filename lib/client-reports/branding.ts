export const REPORT_BRAND_V1={logo:'/report-assets/ouro-fino-v1.png',logoSha256:'54a946f97bef50d4238904c0b47377aa1d1079ef5fb942bf4ee4edd21d00ca94',logoWidth:517,logoHeight:120,green:'#2C593E',deepGreen:'#214632',gold:'#ECC653',marginMm:18,bodyPt:11,notePt:9,coverPt:32,headingPt:18,wordFont:'Arial',chartWidth:2100,chartHeight:900} as const;
// Institutional asset v1 is immutable. Future logos require a new path and brand version.
export async function loadReportLogo():Promise<Uint8Array>{
  let bytes: Uint8Array;
  if(typeof window==='undefined'){
    try {
      const dynamicImport = new Function('m', 'return import(m)');
      const fs = await dynamicImport('node:fs');
      const path = await dynamicImport('node:path');
      const p = path.resolve('public/report-assets/ouro-fino-v1.png');
      bytes = new Uint8Array(fs.readFileSync(p));
    } catch {
      const r = await fetch(REPORT_BRAND_V1.logo);
      if(!r.ok) throw new Error('Logotipo do relatório indisponível.');
      bytes = new Uint8Array(await r.arrayBuffer());
    }
  } else {
    const r = await fetch(REPORT_BRAND_V1.logo);
    if(!r.ok) throw new Error('Logotipo do relatório indisponível.');
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as unknown as BufferSource))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==REPORT_BRAND_V1.logoSha256)throw new Error('Integridade do logotipo divergente.');
  return bytes;
}
