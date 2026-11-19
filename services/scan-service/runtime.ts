import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {containerArgs,type ContainerSpec,type Limits} from './limits';
const exec=promisify(execFile);
export type Execution={exitCode:number|null;timedOut:boolean;truncated:boolean;outputBytes:number;stdout:Buffer;runtimeError?:boolean};
export type Running={name:string;ready:Promise<void>;completion:Promise<Execution>};
export interface ContainerRuntime{createNetwork(name:string,deadline?:number):Promise<void>;removeNetwork(name:string):Promise<void>;start(spec:ContainerSpec,limits:Limits,signal:AbortSignal):Promise<Running>;copyFrom(name:string,target:string):Promise<void>;remove(name:string):Promise<void>;}
export class DockerRuntime implements ContainerRuntime{
 constructor(private binary='docker'){}
 private async command(args:string[],signal?:AbortSignal){try{return (await exec(this.binary,args,{encoding:'utf8',timeout:10000,maxBuffer:1024*1024,signal})).stdout.trim();}catch{throw new Error('DOCKER_CONTROL_FAILED');}}
 async createNetwork(name:string,deadline=Date.now()+900000){await this.command(['network','create','--internal','--label=aegis.scan.service=v1','--label=aegis.scan.deadline='+deadline,name]);}
 async removeNetwork(name:string){try{await this.command(['network','rm',name]);}catch{const all=await this.command(['network','ls','--filter','name=^'+name+'$','--format','{{.Name}}']);if(all.split('\n').includes(name))throw new Error('NETWORK_CLEANUP_FAILED');}}
 async remove(name:string){try{await this.command(['rm','--force','--volumes',name]);}catch{const all=await this.command(['ps','--all','--filter','name=^/'+name+'$','--format','{{.Names}}']);if(all.split('\n').includes(name))throw new Error('CONTAINER_CLEANUP_FAILED');}}
 async copyFrom(name:string,target:string){await this.command(['cp',name+':/workspace/repo/.',target]);}
 async start(spec:ContainerSpec,limits:Limits,signal:AbortSignal):Promise<Running>{signal.throwIfAborted();try{await this.command(containerArgs(spec,limits),signal);for(const c of spec.connections??[])await this.command(['network','connect',...(c.alias?['--alias',c.alias]:[]),c.network,spec.name],signal);}catch(e){await this.remove(spec.name).catch(()=>{});throw e;}
  let readyResolve!:()=>void,readyReject!:(e:Error)=>void;const ready=new Promise<void>((ok,fail)=>{readyResolve=ok;readyReject=fail;});void ready.catch(()=>{});
  const child=spawn(this.binary,['start','--attach',spec.name],{stdio:['ignore','pipe','pipe']});let count=0,truncated=false,timedOut=false,resolved=false,marker='',chunks:Buffer[]=[];let stored=0;
  const abort=()=>{timedOut=true;child.kill('SIGTERM');void this.remove(spec.name).catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const receive=(bytes:Buffer,stdout:boolean)=>{if(truncated)return;count+=bytes.length;if(count>limits.maxOutputBytes){truncated=true;child.kill('SIGTERM');void this.remove(spec.name).catch(()=>{});return;}if(stdout){if(stored+bytes.length<=limits.maxOutputBytes){chunks.push(bytes);stored+=bytes.length;}if(spec.readyMarker&&!resolved){marker=(marker+bytes.toString('utf8')).slice(-4096);if(marker.split('\n').includes(spec.readyMarker)){resolved=true;readyResolve();}}}};
  child.stdout.on('data',(b:Buffer)=>receive(b,true));child.stderr.on('data',(b:Buffer)=>receive(b,false));if(!spec.readyMarker){resolved=true;readyResolve();}
  const completion=new Promise<Execution>(resolve=>{let done=false;const finish=(code:number|null,error=false)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);if(!resolved)readyReject(new Error('CONTAINER_NOT_READY'));resolve({exitCode:code,timedOut,truncated,outputBytes:Math.min(count,limits.maxOutputBytes),stdout:Buffer.concat(chunks),runtimeError:error});};child.on('error',()=>finish(null,true));child.on('close',code=>finish(code));});
  return {name:spec.name,ready,completion};
 }
 /** Restart recovery: never inspect/log container environment or tool output. */
 async verifyRuntime(){const info=JSON.parse(await this.command(['info','--format','{{json .}}']));if(String(info.CgroupVersion)!=='2'||!info.MemoryLimit||!info.PidsLimit||!info.CpuCfsQuota||!info.SecurityOptions?.some((v:string)=>v.includes('rootless')))throw new Error('ROOTLESS_CGROUP_V2_LIMITS_REQUIRED');}
 async recoverAll(){await this.reapExpired(Number.POSITIVE_INFINITY);}
 async reapExpired(now=Date.now()){
  for(const type of ['container','network'] as const){const rows=await this.command(type==='container'?['ps','--all','--filter','label=aegis.scan.service=v1','--format','{{.Names}}']:['network','ls','--filter','label=aegis.scan.service=v1','--format','{{.Name}}']);
   for(const name of rows.split('\n').filter(Boolean)){if(!/^aegis-[a-z0-9-]+$/.test(name))continue;const deadline=Number(await this.command(type==='container'?['inspect','--format','{{index .Config.Labels "aegis.scan.deadline"}}',name]:['network','inspect','--format','{{index .Labels "aegis.scan.deadline"}}',name]));if(!deadline||deadline<now){if(type==='container')await this.remove(name);else await this.removeNetwork(name);}}
  }
 }
}
