import {createServer} from 'node:http';
import worker from '../dist/server/index.js';
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.split('=')[1] ?? 5187);
const server=createServer(async(req,res)=>{
  try {
    const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers});
    const response=await worker.fetch(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Preview failed'); }
});
server.listen(port,'127.0.0.1',()=>console.log('Hosted preview: http://localhost:'+port));
