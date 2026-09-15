import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {narratorApi} from './narrator-api.mjs';

const root=fileURLToPath(new URL('./public/',import.meta.url));
const types={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const narrator=narratorApi();
const server=createServer(async(req,res)=>{
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    if(await narrator.handle(req,res,origin))return;
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    const pathname=decodeURIComponent(new URL(req.url,origin).pathname);
    const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!path.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}
    const bytes=await readFile(path);
    res.writeHead(200,{
      'Content-Type':types[extname(path)]??'application/octet-stream',
      'Content-Length':bytes.length,'Cache-Control':'no-cache',
      'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'"
    });
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){
    if(res.destroyed)return;
    res.writeHead(error.code==='ENOENT'?404:400).end('This local asset is unavailable.');
  }
});
server.on('error',error=>{console.error(`Local server: ${error.message}`);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();narrator.close().finally(()=>process.exit(0));});
server.listen(Number(process.argv[2]??4317),'127.0.0.1',()=>console.log(`Work Aloud: http://127.0.0.1:${server.address().port}`));
