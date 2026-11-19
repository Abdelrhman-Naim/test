import type {CDPSession} from 'playwright';import {SsrfBlockedError,responseHeaderEntries} from './network';import {assertBrowserRedirectChain,type RedirectChain} from './resource-policy';
type Paused={requestId:string;redirectedRequestId?:string;frameId:string;resourceType:string;request:{url:string;method:string;headers:Record<string,unknown>}};
export type GuardedRoute={request:()=>RedirectChain&{url:()=>string;method:()=>string;headers:()=>Record<string,string>;resourceType:()=>string;isNavigationRequest:()=>boolean;isMainDocument:()=>boolean};fulfill:(response:{status:number;headers:Record<string,string>;body:Buffer})=>Promise<void>;abort:(reason?:string)=>Promise<void>};
// Playwright context.route skips redirect hops. CDP Fetch pauses every hop,
// allowing native redirect URL/base/cookie semantics without unguarded egress.
export async function installGuardedRoutes(session:CDPSession,handler:(route:GuardedRoute)=>Promise<void>){
 const tree=await session.send('Page.getFrameTree'),main=tree.frameTree.frame.id,chains=new Map<string,RedirectChain>();let stopped=false;
 const fail=(id:string)=>session.send('Fetch.failRequest',{requestId:id,errorReason:'BlockedByClient'});
 const paused=async(event:Paused)=>{
  try{
   if(stopped||chains.size>=150)throw new SsrfBlockedError('انتهت ميزانية موارد المتصفح');
   const previous=event.redirectedRequestId?chains.get(event.redirectedRequestId):null;if(event.redirectedRequestId&&!previous)throw new SsrfBlockedError('سلسلة تحويل غير موثقة');
   const chain:RedirectChain={redirectedFrom:()=>previous??null};assertBrowserRedirectChain(chain);chains.set(event.requestId,chain);
   const kind=event.resourceType.toLowerCase(),request={...chain,url:()=>event.request.url,method:()=>event.request.method,headers:()=>Object.fromEntries(Object.entries(event.request.headers).map(([k,v])=>[k.toLowerCase(),String(v)])),resourceType:()=>kind,isNavigationRequest:()=>kind==='document',isMainDocument:()=>kind==='document'&&event.frameId===main};
   await handler({request:()=>request,fulfill:async response=>{await session.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:response.status,responseHeaders:responseHeaderEntries(response.headers).map(([name,value])=>({name,value})),body:response.body.toString('base64')});},abort:async()=>{await fail(event.requestId);}});
  }catch{await fail(event.requestId).catch(()=>{});}
 };
 const listener=(event:Paused)=>{void paused(event);};session.on('Fetch.requestPaused',listener);
 try{await session.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});}catch(error){session.off('Fetch.requestPaused',listener);throw error;}
 return ()=>{stopped=true;session.off('Fetch.requestPaused',listener);};
}
