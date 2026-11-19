import {redact} from './redaction';
export {redact} from './redaction';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import type {HttpPage} from './types';

export class SsrfBlockedError extends Error{constructor(message='SSRF destination blocked'){super(message);this.name='SsrfBlockedError';}}
export function assertPublicAddress(address:string){
  let parsed;try{parsed=ipaddr.parse(address.replace(/^\[|\]$/g,''));}catch{throw new SsrfBlockedError('عنوان شبكة غير صالح');}
  if(parsed.kind()==='ipv6'&&(parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed=(parsed as ipaddr.IPv6).toIPv4Address();
  if(parsed.range()!=='unicast') throw new SsrfBlockedError('الوصول إلى الشبكات الخاصة أو المحجوزة غير مسموح');
}
export function validateTarget(input:string){
  let u:URL;try{u=new URL(input);}catch{throw new SsrfBlockedError('رابط غير صالح');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port))) throw new SsrfBlockedError('أدخل رابط HTTP أو HTTPS عامًا بلا بيانات اعتماد أو منفذ مخصص');
  const h=u.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(h==='localhost'||!h.includes('.')&&!h.includes(':')||/\.(local|localhost|internal|test|invalid)$/.test(h)) throw new SsrfBlockedError('النطاق المحلي غير مسموح');
  if(isIP(h)) assertPublicAddress(h);
  u.hash='';let decoded=u.href;try{decoded=decodeURIComponent(decoded);}catch{}
  if(redact(decoded)!==decoded)throw new Error('الرابط يحتوي سرًا محتملًا؛ احذفه من الرابط قبل حفظ المشروع');
  return u;
}
export function assertResolved(addresses:{address:string;family:number}[]){if(!addresses.length)throw new SsrfBlockedError('تعذر حل النطاق');for(const a of addresses){if(isIP(a.address)!==a.family)throw new SsrfBlockedError('إجابة DNS غير صالحة');assertPublicAddress(a.address);}}
export function pinnedLookup(pinned:{address:string;family:number}){return (_host:string,options:{all?:boolean},cb:(error:Error|null,address:unknown,family?:number)=>void)=>options.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family);}


export function decodeBody(raw:Buffer,encoding:string|undefined,max=2*1024*1024){
 if(encoding==='gzip')return gunzipSync(raw,{maxOutputLength:max});
 if(encoding==='br')return brotliDecompressSync(raw,{maxOutputLength:max});
 if(encoding==='deflate')return inflateSync(raw,{maxOutputLength:max});
 if(encoding&&encoding!=='identity')throw new Error('ترميز استجابة غير مدعوم');
 if(raw.length>max)throw new Error('تجاوز الحجم المسموح');return raw;
}
export function decodeHttpResponseBody(raw:Buffer,encoding:string|undefined,max:number,method:string,status:number){return method==='HEAD'||status===204||status===304?Buffer.alloc(0):decodeBody(raw,encoding,max);}
export async function resolvePublicHostname(hostname:string,signal?:AbortSignal,resolver:(hostname:string)=>Promise<{address:string;family:number}[]>=name=>lookup(name,{all:true})){
 signal?.throwIfAborted();let timer:ReturnType<typeof setTimeout>|undefined;let abort:()=>void=()=>{};
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('انتهت مهلة DNS')),5000);timer.unref();abort=()=>reject(new Error('أُلغي انتظار DNS'));signal?.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([resolver(hostname),deadline]);}finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export type ResolvedTarget={url:URL;ip:string;family:number};
export type Resolver=(hostname:string)=>Promise<{address:string;family:number}[]>;
export type ResourceOptions={origin?:string;method?:'GET'|'HEAD'|'OPTIONS'|'POST';body?:string;maxResponseBytes?:number;headers?:Record<string,string>;signal?:AbortSignal;redirect?:'manual'|'follow'|'error';allowUrl?:(url:string)=>boolean;resolver?:Resolver;send?:(target:ResolvedTarget,options:ResourceOptions)=>Promise<HttpPage>};
export async function resolveAndValidate(input:string,options:{signal?:AbortSignal;resolver?:Resolver}={}):Promise<ResolvedTarget>{
 const url=validateTarget(input),hostname=url.hostname.replace(/^\[|\]$/g,'');options.signal?.throwIfAborted();let addresses:{address:string;family:number}[];
 try{addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolvePublicHostname(hostname,options.signal,options.resolver);}catch(error){options.signal?.throwIfAborted();throw new SsrfBlockedError('تعذر التحقق من DNS للوجهة');}
 options.signal?.throwIfAborted();assertResolved(addresses);const pinned=addresses.find(a=>a.family===4)??addresses[0];return {url,ip:pinned.address,family:pinned.family};
}
async function sendValidated(target:ResolvedTarget,options:ResourceOptions):Promise<HttpPage>{
 const u=target.url,pinned={address:target.ip,family:target.family},start=Date.now();
 const maxResponse=Math.min(8*1024*1024,Math.max(1,options.maxResponseBytes??2*1024*1024));
 const headers:Record<string,string>={};for(const [key,value]of Object.entries(options.headers??{}))headers[key.toLowerCase()]=value;
 // Preserve the validated virtual host/TLS SNI even if a caller supplied Host.
 headers.host=u.host;
  const response=await new Promise<HttpPage>((resolve,reject)=>{
    const transport=u.protocol==='https:'?https:http;
    const req=transport.request(u,{method:options.method??'GET',signal:options.signal,agent:false,...(u.protocol==='https:'&&!isIP(u.hostname.replace(/^\[|\]$/g,''))?{servername:u.hostname}:{}),headers:{'user-agent':'AegisAuditBeta/0.5 (authorized passive audit)','accept':'*/*',...headers,'accept-encoding':'identity'},lookup:pinnedLookup(pinned) as never},res=>{
      const chunks:Buffer[]=[];let bytes=0;
      res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>maxResponse){req.destroy(new Error('تجاوز حجم الصفحة 2MB'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>{try{const headers:Record<string,string>={};for(const [k,v] of Object.entries(res.headers)){if(v!==undefined)headers[k]=Array.isArray(v)?v.join('\n'):v;}const raw=decodeHttpResponseBody(Buffer.concat(chunks),headers['content-encoding'],maxResponse,options.method??'GET',res.statusCode??0);delete headers['content-encoding'];delete headers['content-length'];resolve({url:u.href,status:res.statusCode??0,headers,body:raw.toString('utf8'),rawBody:raw,elapsedMs:Date.now()-start,bytes});}catch(e){reject(e);}});
    });
    const timer=setTimeout(()=>req.destroy(new Error('انتهت مهلة جلب الصفحة')),15000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(options.body);
  });
  return response;
}
export async function safeFetchPage(input:string,options:ResourceOptions={}):Promise<HttpPage>{
 options.signal?.throwIfAborted();if(options.body&&Buffer.byteLength(options.body)>65536)throw new Error('حجم طلب الخدمة يتجاوز الحد');
 if(options.method==='POST'&&input!=='https://api.osv.dev/v1/querybatch')throw new Error('طلبات POST محصورة بخدمة OSV المعتمدة');
 let current=input,headers=options.headers;for(let hop=0;hop<=3;hop++){
  const target=await resolveAndValidate(current,{signal:options.signal,resolver:options.resolver});
  if(options.origin&&target.url.origin!==options.origin)throw new SsrfBlockedError('إعادة توجيه أو طلب خارج النطاق المعتمد');
  if(options.allowUrl&&!options.allowUrl(target.url.href))throw new SsrfBlockedError('الوجهة مستبعدة حسب سياسة الزحف');
  const response=await (options.send??sendValidated)(target,{...options,headers});options.signal?.throwIfAborted();
  if(![301,302,303,307,308].includes(response.status)||options.redirect!=='follow'){if(options.redirect==='error'&&[301,302,303,307,308].includes(response.status))throw new SsrfBlockedError('إعادة التوجيه غير مسموحة');return response;}
  if(hop===3)throw new SsrfBlockedError('تجاوز حد إعادة التوجيه');if(!response.headers.location)throw new SsrfBlockedError('إعادة توجيه بلا وجهة');
  let next:URL;try{next=validateTarget(new URL(response.headers.location,target.url).href);}catch(error){if(error instanceof SsrfBlockedError)throw error;throw new SsrfBlockedError('وجهة إعادة توجيه غير صالحة');}
  if(next.origin!==target.url.origin){if(options.method==='POST')throw new SsrfBlockedError('إعادة توجيه POST خارج النطاق');headers=Object.fromEntries(Object.entries(headers??{}).filter(([key])=>!['authorization','proxy-authorization','cookie','apikey','x-api-key','host'].includes(key.toLowerCase())));}
  current=next.href;
 }
 throw new SsrfBlockedError('تجاوز حد إعادة التوجيه');
}
export function responseHeaderEntries(headers:Record<string,string>):[string,string][]{return Object.entries(headers).flatMap(([name,value])=>name.toLowerCase()==='set-cookie'?value.split('\n').filter(Boolean).map(cookie=>[name,cookie] as [string,string]):[[name,value] as [string,string]]);}
// Response interface for new Worker integrations; existing collectors retain
// HttpPage metrics through safeFetchPage. Both use the same pinned transport.
export async function safeFetch(input:string,options:ResourceOptions={}):Promise<Response>{
 const page=await safeFetchPage(input,{...options,redirect:options.redirect??'follow'});const response=new Response(options.method==='HEAD'||[204,205,304].includes(page.status)?null:Buffer.from(page.rawBody??page.body),{status:page.status,headers:responseHeaderEntries(page.headers)});Object.defineProperty(response,'url',{value:page.url});return response;
}
// Compatibility only: no alternate/unguarded network path.
export const requestResource=safeFetchPage;
export type CollectOptions={signal?:AbortSignal;allowUrl?:(url:string)=>boolean;transport?:typeof safeFetchPage};
export async function collect(input:string,origin?:string,hop=0,options:CollectOptions={}):Promise<HttpPage>{
 options.signal?.throwIfAborted();if(options.allowUrl&&!options.allowUrl(input))throw new SsrfBlockedError('الوجهة مستبعدة حسب سياسة الزحف');
 if(hop>3)throw new SsrfBlockedError('تجاوز حد إعادة التوجيه');const u=validateTarget(input);const response=await(options.transport??safeFetchPage)(u.href,{origin,signal:options.signal});options.signal?.throwIfAborted();
 if([301,302,303,307,308].includes(response.status)){
  if(!response.headers.location)throw new SsrfBlockedError('إعادة توجيه بلا وجهة');let next:URL;try{next=validateTarget(new URL(response.headers.location,u).href);}catch(error){if(error instanceof SsrfBlockedError)throw error;throw new SsrfBlockedError('وجهة إعادة توجيه غير صالحة');}if(next.origin!==u.origin)throw new SsrfBlockedError('إعادة التوجيه تتطلب اعتماد الرابط النهائي كمشروع مستقل');return collect(next.href,origin??u.origin,hop+1,options);
 }
 return response;
}
