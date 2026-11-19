import {spawnSync} from 'node:child_process';import {validateRepo} from './repo-guard.mjs';
const [target,branch,history]=process.argv.slice(2);const timeout=Number(process.env.AEGIS_TIMEOUT_MS)||300000;
const timer=setTimeout(()=>process.exit(124),timeout);timer.unref();
try{if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(target)||!branch||branch.startsWith('-')||/[\x00-\x20~^:?*\[\\]/.test(branch)||branch.includes('..'))throw new Error('CLONE_INPUT');
 const flags=['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-c','protocol.https.allow=always','-c','protocol.file.allow=never','-c','protocol.ext.allow=never','-c','submodule.recurse=false','-c','http.followRedirects=false','-c','filter.lfs.required=false','-c','filter.lfs.smudge=','-c','filter.lfs.process=','clone','--no-recurse-submodules','--branch',branch,...(history==='full'?[]:['--depth=1','--single-branch']),'--',target,'/workspace/repo'];
 const result=spawnSync('git',flags,{stdio:'ignore',timeout,env:{...process.env,HOME:'/tmp',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_LFS_SKIP_SMUDGE:'1',HTTPS_PROXY:'http://github-egress:3128',HTTP_PROXY:'http://github-egress:3128',ALL_PROXY:'',NO_PROXY:''}});if(result.error||result.status!==0)throw new Error('CLONE_FAILED');
 await validateRepo('/workspace/repo',JSON.parse(process.env.AEGIS_REPO_LIMITS??'{}'));
 process.stdout.write('AEGIS_CLONE_READY\n');setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));
}catch{process.stderr.write('CLONE_OR_REPO_VALIDATION_FAILED\n');process.exitCode=1;}
