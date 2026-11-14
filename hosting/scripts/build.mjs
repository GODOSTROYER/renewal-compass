import {readFile,mkdir,rm,writeFile,copyFile,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),path=(...parts)=>join(root,...parts);
const read=(...parts)=>readFile(path(...parts),'utf8');
const assetSpecs={'/':['index.html','text/html'],'/styles.css':['styles.css','text/css'],'/app.mjs':['app.mjs','text/javascript'],'/data.mjs':['data.mjs','text/javascript']};
const assets={};
for(const [route,[file,type]] of Object.entries(assetSpecs)){
 let source=await read('crm',file);
 if(route==='/'){
  if(!source.includes('<script type="module"'))throw Error('Missing app bootstrap in HTML');
  source=source.replace('<script type="module"','<script src="/config.js"></script><script type="module"');
 }
 assets[route]=[source,type];
}
function unexport(src){
 return src.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
}
const data=unexport(await read('crm','data.mjs')),reasoning=unexport(await read('crm','reasoning.mjs')),organizer=unexport(await read('crm','organizer-map.mjs'));
const runtime=await read('worker','runtime.mjs');
const workerBody=`const ASSETS=${JSON.stringify(assets)};\nconst {normalizeOrganizer}=(()=>{\n${data}\n${reasoning}\n${organizer}\nreturn {normalizeOrganizer};})();\n${runtime}`;
const fingerprint=createHash('sha256').update(workerBody).digest('hex');
const worker=`const RELEASE_FINGERPRINT=${JSON.stringify(fingerprint)};\n${workerBody}`;
const built=await import('data:text/javascript;base64,'+Buffer.from(worker).toString('base64'));
if(typeof built.default?.fetch!=='function')throw Error('Build requires default.fetch Worker export');
if(process.argv.includes('--check')){console.log('Worker ESM validated');process.exit(0);}
await rm(path('dist'),{force:true,recursive:true});
await mkdir(path('dist','server'),{recursive:true});await mkdir(path('dist','.openai'),{recursive:true});
await writeFile(path('dist','server','index.js'),worker);
try{
 await copyFile(path('.openai','hosting.json'),path('dist','.openai','hosting.json'));
}catch(error){
 if(error.code!=='ENOENT')throw error;
 // Public checkouts build locally with a placeholder, never a deployment identity.
 await copyFile(path('.openai','hosting.example.json'),path('dist','.openai','hosting.json'));
 console.log('Using public example hosting manifest: local verification only; configure .openai/hosting.json before deployment.');
}
await cp(path('drizzle'),path('dist','.openai','drizzle'),{recursive:true});
console.log('Worker built: dist/server/index.js; migrations: dist/.openai/drizzle; fingerprint: '+fingerprint);
