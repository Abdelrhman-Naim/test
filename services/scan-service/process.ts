import {setTimeout as sleep} from 'node:timers/promises';import {runTool,type RunnerOptions} from './runner';import {failedResults,type Queue,type Job} from './protocol';
type Controls={global:number;perOwner:number;pollMs?:number;renewMs?:number};
class CleanupFailure extends Error{}
export async function processJob(queue:Queue,job:Job,options:RunnerOptions,shutdown?:AbortSignal,admit=async()=>{},renewMs=5000){
 const controller=new AbortController(),signal=shutdown?AbortSignal.any([shutdown,controller.signal]):controller.signal;
 const timer=setInterval(()=>{void queue.renew(job.id,job.token!).then(ok=>{if(!ok)controller.abort();}).catch(()=>controller.abort());},renewMs);
 try{await admit();signal.throwIfAborted();const results=[];for(const tool of job.request.tools){signal.throwIfAborted();const result=await runTool(tool,job.request,options,signal);results.push(result);if(result.reason==='cleanup_incomplete')throw new CleanupFailure();}await queue.finish(job.id,job.token!,results);}
 catch(error){await queue.finish(job.id,job.token!,failedResults(job.request,'job_interrupted'),true).catch(()=>{});if(error instanceof CleanupFailure)throw error;}
 finally{clearInterval(timer);}
}
export async function processQueue(queue:Queue,options:RunnerOptions,shutdown:AbortSignal,controls:Controls={global:2,perOwner:1}){
 const controller=new AbortController(),signal=AbortSignal.any([shutdown,controller.signal]);let fatal:unknown;
 const active=new Map<string,{owner:string;task:Promise<void>}>(),executing=new Map<string,string>();
 try{while(!signal.aborted){
  // Logical Redis leases can be released before physical cleanup. These local
  // slots remain occupied until runTool's finally completes, including on cancel.
  if(active.size>=controls.global){await sleep(controls.pollMs??250,undefined,{signal}).catch(()=>{});continue;}
  let job:Job|undefined;try{job=await queue.claim();}catch{}
  if(job){const current=job;const admit=async()=>{while([...executing.values()].filter(owner=>owner===current.request.ownerId).length>=controls.perOwner){signal.throwIfAborted();const same=[...active.entries()].filter(([id,v])=>id!==current.id&&v.owner===current.request.ownerId&&executing.has(id)).map(([,v])=>v.task);await Promise.race(same);}signal.throwIfAborted();executing.set(current.id,current.request.ownerId);};
   const task=processJob(queue,current,options,signal,admit,controls.renewMs??5000).catch(error=>{fatal=error;controller.abort();}).finally(()=>{executing.delete(current.id);active.delete(current.id);});active.set(current.id,{owner:current.request.ownerId,task});
  }else await sleep(controls.pollMs??250,undefined,{signal}).catch(()=>{});
 }}finally{controller.abort();await Promise.allSettled([...active.values()].map(v=>v.task));}if(fatal)throw fatal;
}
