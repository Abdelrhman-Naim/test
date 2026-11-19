import {trufflehogCompleted} from './secret-diagnostics.mjs';
import {spawnSync} from 'node:child_process';import {readFileSync,statSync,rmSync} from 'node:fs';import {SECRET_VERSIONS,secretArguments} from './secret-arguments.mjs';
// Trusted image entrypoint; target source is never executed. Raw output lives in
// this process/tmpfs only until the controller parser redacts it. No tool logs.
const [tool,mode]=process.argv.slice(2),cap=50*1024**2;let buffers=[];
try{const expected=SECRET_VERSIONS[tool];if(!expected||!['git','directory'].includes(mode))throw 0;const version=spawnSync(tool,tool==='gitleaks'?['version']:['--version'],{encoding:'utf8',timeout:10000,maxBuffer:8192});if(version.status!==0||!(version.stdout+' '+version.stderr).split(/[^\d.]+/).includes(expected))throw 0;
 for(const pass of mode==='git'?['git','directory']:['directory']){const out=spawnSync(tool,secretArguments(tool,pass),{timeout:850000,maxBuffer:cap,stdio:['ignore',tool==='gitleaks'?'ignore':'pipe','pipe'],cwd:'/tmp',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_LFS_SKIP_SMUDGE:'1',GIT_TERMINAL_PROMPT:'0'}});if(out.error||out.status!==0||(out.stdout?.length??0)+(out.stderr?.length??0)>cap)throw 0;const stderr=out.stderr??Buffer.alloc(0);const diagnosticsOk=tool==='trufflehog'?trufflehogCompleted(stderr.toString('utf8'),expected):stderr.length===0;stderr.fill(0);if(!diagnosticsOk)throw 0;
  if(tool==='gitleaks'){if(statSync('/tmp/gitleaks.json').size>cap)throw 0;const raw=readFileSync('/tmp/gitleaks.json');rmSync('/tmp/gitleaks.json');const parsed=JSON.parse(raw.toString());raw.fill(0);if(!Array.isArray(parsed))throw 0;buffers.push(Buffer.from(JSON.stringify(parsed)));}
  else buffers.push(out.stdout??Buffer.alloc(0));if(buffers.reduce((n,b)=>n+b.length,0)>cap)throw 0;
 }
 if(tool==='gitleaks'){const combined=buffers.flatMap(b=>JSON.parse(b.toString()));process.stdout.write(JSON.stringify(combined));}else for(const b of buffers){process.stdout.write(b.toString('utf8')+'\n');}
}catch{process.exitCode=1;}finally{for(const b of buffers)b.fill(0);}
