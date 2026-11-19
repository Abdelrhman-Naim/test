import http from 'node:http';import https from 'node:https';import {createHash} from 'node:crypto';import {authenticate} from './auth';import {parseScanRequest,type Queue,type ToolResult} from './protocol';
export function createScanServer(options:{secret:string;queue:Queue;allowedIps:string[];tls?:{key:Buffer;cert:Buffer}}){
 const handler: http.RequestListener=async(req,res)=>{const reply=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
 try{const ip=(req.socket.remoteAddress??'').replace(/^::ffff:/,'');if(!options.allowedIps.includes(ip)){reply(403,{error:'WORKER_IP_REQUIRED'});return;}
  const chunks:Buffer[]=[];let size=0;for await(const value of req){const chunk=Buffer.from(value);size+=chunk.length;if(size>65536){reply(413,{error:'BODY_TOO_LARGE'});req.destroy();return;}chunks.push(chunk);}const raw=Buffer.concat(chunks),ts=req.headers['x-timestamp'],sig=req.headers['x-signature'];
  try{authenticate(options.secret,typeof ts==='string'?ts:undefined,typeof sig==='string'?sig:undefined,raw);}catch{reply(401,{error:'UNAUTHORIZED'});return;}
  const url=new URL(req.url??'/','http://service.invalid');if(url.search){reply(400,{error:'QUERY_NOT_ALLOWED'});return;}
  if(req.method==='POST'&&url.pathname==='/scans'){
   let input;try{input=parseScanRequest(JSON.parse(raw.toString('utf8')));}catch{reply(400,{error:'INVALID_SCAN_OR_UNKNOWN_TOOL'});return;}
   if(!await options.queue.reserveNonce(createHash('sha256').update(String(ts)+'.'+String(sig)).digest('hex'))){reply(409,{error:'REPLAYED_REQUEST'});return;}
   try{reply(202,{jobId:await options.queue.submit(input)});}catch(error){reply(error instanceof Error&&['FULL','DUPLICATE'].includes(error.message)?429:503,{error:'QUEUE_UNAVAILABLE_OR_LIMIT'});}return;
  }
  const match=/^\/scans\/([a-f0-9-]{36})(\/cancel)?$/.exec(url.pathname);
  if(match&&req.method==='POST'&&match[2]){let cancel;try{cancel=JSON.parse(raw.toString('utf8'));}catch{reply(400,{error:'INVALID_CANCEL'});return;}if(cancel.jobId!==match[1]){reply(400,{error:'INVALID_CANCEL'});return;}reply(200,{cancelled:await options.queue.cancel(match[1])});return;}
  if(match&&req.method==='GET'&&!match[2]&&raw.length===0){const job=await options.queue.get(match[1]);if(!job){reply(404,{error:'NOT_FOUND'});return;}reply(200,{jobId:job.id,scanId:job.request.scanId,status:job.status,results:job.results,toolStatus:job.toolStatus});return;}
  reply(404,{error:'NOT_FOUND'});
 }catch{if(!res.headersSent)reply(503,{error:'SERVICE_UNAVAILABLE'});else res.destroy();}};
 const server=options.tls?https.createServer(options.tls,handler):http.createServer(handler);server.headersTimeout=5000;server.requestTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=32;server.maxConnections=64;return server;
}
