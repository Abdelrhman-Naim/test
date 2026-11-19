import {readFile,lstat} from 'node:fs/promises';import {join} from 'node:path';
/** Only benchmark-generated minimal Git configuration is accepted. TH3.88.23
 * drops GIT_CONFIG_* in its subprocesses; env-only hardening is insufficient. */
export async function assertSafeLocalGit(root:string){const git=join(root,'.git');const st=await lstat(git).catch(()=>undefined);if(!st)return false;if(!st.isDirectory()||st.isSymbolicLink())throw new Error('UNSAFE_LOCAL_GIT_DIRECTORY');
 for(const name of ['config.worktree','commondir','objects/info/alternates'])if(await lstat(join(git,name)).then(()=>true,()=>false))throw new Error('UNSAFE_LOCAL_GIT_EXTENSION');
 const config=await readFile(join(git,'config'),'utf8');if(Buffer.byteLength(config)>8192)throw new Error('LOCAL_GIT_CONFIG_LIMIT');let core=false;
 const allowed:Record<string,RegExp>={repositoryformatversion:/^0$/,bare:/^false$/,filemode:/^(?:true|false)$/,logallrefupdates:/^(?:true|false)$/};
 for(const line of config.split(/\r?\n/)){const s=line.trim();if(!s||/^[#;]/.test(s))continue;if(s==='[core]'){core=true;continue;}const m=s.match(/^([a-zA-Z]+)\s*=\s*(\S+)$/);if(!core||!m||!Object.hasOwn(allowed,m[1].toLowerCase())||!allowed[m[1].toLowerCase()].test(m[2]))throw new Error('UNSAFE_LOCAL_GIT_CONFIG');}
 return true;
}
