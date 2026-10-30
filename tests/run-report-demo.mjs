import {spawn} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import net from 'node:net';
const scratch=path.resolve('../tmp/client-reports');fs.mkdirSync(scratch,{recursive:true});
const env={...process.env,XDG_CONFIG_HOME:path.join(scratch,'firebase-config'),FIREBASE_EMULATORS_PATH:path.join(scratch,'emulators'),CI:'true',FIREBASE_CLI_DISABLE_USAGE_REPORTING:'true',NEXT_PUBLIC_REPORTS_EMULATORS:'true',NEXT_PUBLIC_FIREBASE_API_KEY:'demo-key',NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:'demo-client-reports.firebaseapp.com',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-client-reports',NEXT_PUBLIC_FIREBASE_APP_ID:'demo-client-reports',NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:'demo-client-reports.appspot.com',NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:'0000000000'};
env.PATH=path.dirname(process.execPath)+path.delimiter+env.PATH;
const javaDir=path.join(scratch,'java');if(fs.existsSync(javaDir)){const runtime=fs.readdirSync(javaDir,{withFileTypes:true}).find(e=>e.isDirectory()&&fs.existsSync(path.join(javaDir,e.name,'bin','java.exe')));if(runtime)env.PATH=path.join(javaDir,runtime.name,'bin')+path.delimiter+env.PATH;}
for(const port of [3000,8080,9099])await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(new Error(`Porta ${port} ocupada. Nenhum processo foi encerrado.`)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});
const children=[];
function start(name,args){const log=fs.openSync(path.join(scratch,`${name}.log`),'w'),child=spawn(process.execPath,args,{env,stdio:['ignore',log,log]});children.push(child);console.log(`${name}: processo ${child.pid}`);child.on('exit',code=>{console.log(`${name} encerrou (${code})`);});return child;}
const state=path.join(scratch,'emulator-state');
start('demo-emulators',['node_modules/firebase-tools/lib/bin/firebase.js','emulators:start','--only','auth,firestore','--project','demo-client-reports','--export-on-exit',state,...(fs.existsSync(path.join(state,'firebase-export-metadata.json'))?['--import',state]:[])]);
start('demo-next',['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3000']);
console.log('Demonstração exclusivamente local. Após inicializar, execute node tests/seed-report-demo.mjs.');
function stop(){for(const child of children)child.kill('SIGTERM');process.exit();}process.on('SIGINT',stop);process.on('SIGTERM',stop);setInterval(()=>{},30000);
