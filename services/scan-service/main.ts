import {readFile,lstat,statfs} from 'node:fs/promises';import {readServiceConfig} from './config';import {DockerRuntime} from './runtime';import {RedisClient} from './redis';import {RedisQueue} from './queue';import {createScanServer} from './server';import {processQueue} from './process';import {recoverWorkspaces} from './recovery';
async function main(){
 if(process.getuid?.()===0)throw new Error('NON_ROOT_USER_REQUIRED');if(process.env.AEGIS_CONTROLLER_LOCKED!=='1')throw new Error('USE_LOCKED_SERVICE_LAUNCHER');
 const config=readServiceConfig();if(config.host!=='127.0.0.1'&&(!config.tlsKey||!config.tlsCert))throw new Error('TLS_REQUIRED_FOR_NON_LOOPBACK');
 const rootStat=await lstat(config.workRoot),fsStat=await statfs(config.workRoot);if(rootStat.isSymbolicLink()||rootStat.uid!==process.getuid?.()||(rootStat.mode&0o077)!==0||fsStat.type!==0x01021994)throw new Error('PRIVATE_OWNED_TMPFS_WORK_ROOT_REQUIRED');
 const runtime=new DockerRuntime();await runtime.verifyRuntime();
 // Launcher holds an OS flock for this private work root. No prior controller
 // can be active while recovery removes its containers, networks and input data.
 await runtime.recoverAll();await recoverWorkspaces(config.workRoot);
 const redis=new RedisClient(config.redis);if(await redis.command(['PING'])!=='PONG')throw new Error('REDIS_REQUIRED');const queue=new RedisQueue(redis,{global:config.global,perOwner:config.perOwner,leaseMs:30000,prefix:'aegis-scan',now:()=>Date.now()});
 const server=createScanServer({secret:config.secret,queue,allowedIps:config.ips,...(config.tlsKey&&config.tlsCert?{tls:{key:await readFile(config.tlsKey),cert:await readFile(config.tlsCert)}}:{})});const controller=new AbortController();let serverError:unknown;
 for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{controller.abort();server.close();});
 server.on('error',error=>{serverError=error;controller.abort();});
 await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(config.port,config.host,()=>{server.removeListener('error',fail);ok();});});
 const reaper=setInterval(()=>{void runtime.reapExpired().catch(()=>{controller.abort();serverError=new Error('RECOVERY_FAILED');});},10000);
 console.log('Scan service ready; authenticated worker access only.');
 try{await processQueue(queue,{runtime,images:config.images,helperImage:config.helperImage,proxyImage:config.proxyImage,workRoot:config.workRoot,egressNetwork:config.egressNetwork,limits:config.limits},controller.signal,{global:config.global,perOwner:config.perOwner});if(serverError)throw serverError;}
 finally{clearInterval(reaper);server.close();}
}
main().catch(()=>{console.error('Scan service startup/runtime failed: verify locked non-root/rootless-cgroup runtime, pinned images, Redis, TLS and required configuration. No target content logged.');process.exitCode=1;});
