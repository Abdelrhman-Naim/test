import {randomUUID} from 'node:crypto';import {RedisClient} from './redis';import type {Queue,ScanRequest,Job,ToolResult} from './protocol';
const common=`
local p=ARGV[1];local now=tonumber(ARGV[2]);local leases=p..':leases';local running=p..':running';local active=p..':active'
local function release(j) redis.call('ZREM',leases,j.id);redis.call('HINCRBY',running,j.request.ownerId,-1);redis.call('HINCRBY',active,j.request.ownerId,-1) end
local function failed(j,reason) j.results={};j.toolStatus={};for _,t in ipairs(j.request.tools) do table.insert(j.results,{tool=t,state='incomplete',findings=cjson.empty_array,reason=reason,outputOmitted=true,execution={attempted=false,durationMs=0,outputBytes=0,truncated=false,exitCode=cjson.null,timedOut=false}});j.toolStatus[t]='incomplete' end;j.status='failed';j.token=nil;return j end
for _,id in ipairs(redis.call('ZRANGEBYSCORE',leases,'-inf',now)) do local raw=redis.call('GET',p..':job:'..id);if raw then local j=cjson.decode(raw);if j.status=='running' then release(j);redis.call('SET',p..':job:'..id,cjson.encode(failed(j,'lease_expired')),'EX',86400) else redis.call('ZREM',leases,id) end else redis.call('ZREM',leases,id) end end
`;
const scripts={submit:common+`
local req=cjson.decode(ARGV[3]);local id=ARGV[4];local q=p..':queue';if redis.call('LLEN',q)>=256 or tonumber(redis.call('HGET',active,req.ownerId) or '0')>=10 then return 'FULL' end
local prior=redis.call('GET',p..':index:'..req.ownerId..':'..req.scanId);if prior then return 'DUPLICATE' end
local j={id=id,request=req,status='queued',createdAt=now,leaseUntil=0,results=cjson.empty_array,toolStatus={}};for _,t in ipairs(req.tools) do j.toolStatus[t]='incomplete' end
redis.call('SET',p..':job:'..id,cjson.encode(j));redis.call('SET',p..':index:'..req.ownerId..':'..req.scanId,id,'EX',86400);redis.call('RPUSH',q,id);redis.call('HINCRBY',active,req.ownerId,1);return id`,
claim:common+`
if redis.call('ZCARD',leases)>=tonumber(ARGV[3]) then return nil end
local q=p..':queue';local count=redis.call('LLEN',q);for i=1,count do local id=redis.call('LPOP',q);local raw=redis.call('GET',p..':job:'..id);if raw then local j=cjson.decode(raw);if j.status=='queued' then if now-j.createdAt>86400000 then redis.call('HINCRBY',active,j.request.ownerId,-1);redis.call('SET',p..':job:'..id,cjson.encode(failed(j,'queue_expired')),'EX',86400) elseif tonumber(redis.call('HGET',running,j.request.ownerId) or '0')<tonumber(ARGV[4]) then j.status='running';j.token=ARGV[6];j.leaseUntil=now+tonumber(ARGV[5]);redis.call('ZADD',leases,j.leaseUntil,id);redis.call('HINCRBY',running,j.request.ownerId,1);local out=cjson.encode(j);redis.call('SET',p..':job:'..id,out);return out else redis.call('RPUSH',q,id) end end end end;return nil`,
get:common+` return redis.call('GET',p..':job:'..ARGV[3])`,
renew:common+` local key=p..':job:'..ARGV[3];local raw=redis.call('GET',key);if not raw then return 0 end;local j=cjson.decode(raw);if j.status~='running' or j.token~=ARGV[4] then return 0 end;j.leaseUntil=now+tonumber(ARGV[5]);redis.call('ZADD',leases,j.leaseUntil,j.id);redis.call('SET',key,cjson.encode(j));return 1`,
finish:common+` local key=p..':job:'..ARGV[3];local raw=redis.call('GET',key);if not raw then return 0 end;local j=cjson.decode(raw);if j.status~='running' or j.token~=ARGV[4] then return 0 end;release(j);j.results=cjson.decode(ARGV[5]);j.toolStatus={};for _,r in ipairs(j.results) do j.toolStatus[r.tool]=r.state=='ok' and 'ok' or 'incomplete' end;j.status=ARGV[6];j.token=nil;redis.call('SET',key,cjson.encode(j),'EX',86400);return 1`,
cancel:common+` local key=p..':job:'..ARGV[3];local raw=redis.call('GET',key);if not raw then return 0 end;local j=cjson.decode(raw);if j.status=='running' then release(j) elseif j.status=='queued' then redis.call('LREM',p..':queue',0,j.id);redis.call('HINCRBY',active,j.request.ownerId,-1) else return 0 end;redis.call('SET',key,cjson.encode(failed(j,'cancelled')),'EX',86400);return 1`};
export class RedisQueue implements Queue{constructor(private redis:RedisClient,private options={global:2,perOwner:1,leaseMs:30000,prefix:'aegis-scan',now:()=>Date.now()}){}
 private eval(kind:keyof typeof scripts,args:string[]){return this.redis.command(['EVAL',scripts[kind],'0',this.options.prefix,String(this.options.now()),...args]);}
 async submit(request:ScanRequest){const id=randomUUID(),reply=await this.eval('submit',[JSON.stringify(request),id]);if(reply==='FULL'||reply==='DUPLICATE')throw new Error(String(reply));if(reply!==id)throw new Error('QUEUE_FAILED');return id;}
 async claim(){const value=await this.eval('claim',[String(this.options.global),String(this.options.perOwner),String(this.options.leaseMs),randomUUID()]);return typeof value==='string'?decodeJob(value):undefined;}
 async get(id:string){const value=await this.eval('get',[id]);return typeof value==='string'?decodeJob(value):undefined;}
 async renew(id:string,token:string){return await this.eval('renew',[id,token,String(this.options.leaseMs)])===1;}
 async finish(id:string,token:string,results:ToolResult[],failed=false){return await this.eval('finish',[id,token,JSON.stringify(results),failed?'failed':'done'])===1;}
 async cancel(id:string){return await this.eval('cancel',[id])===1;}
 async reserveNonce(value:string){return await this.redis.command(['SET',this.options.prefix+':nonce:'+value,'1','NX','EX','121'])==='OK';}
}
function decodeJob(value:string):Job{const job=JSON.parse(value);job.results=Array.isArray(job.results)?job.results:[];for(const r of job.results)r.findings=Array.isArray(r.findings)?r.findings:[];return job;}
