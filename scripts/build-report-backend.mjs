import {build} from 'esbuild';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url))); 
const kind=process.argv[2];if(!['functions','pdf'].includes(kind))throw new Error('Informe functions ou pdf.');
const dir=kind==='functions'?'functions':'services/report-pdf';
await build({entryPoints:[`${dir}/src/${kind==='functions'?'index':'server'}.ts`],outfile:`${dir}/dist/${kind==='functions'?'index':'server'}.js`,bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',sourcemap:true});
if(kind==='pdf'){fs.cpSync('public/report-assets',`${dir}/dist/report-assets`,{recursive:true});}
console.log(`Backend ${kind}: build concluído.`);
