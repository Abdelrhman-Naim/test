import {readdir,lstat,chmod,rm} from 'node:fs/promises';import {join} from 'node:path';
// Private tmpfs only; never follow a repository-controlled symlink during cleanup.
export async function removeWorkspace(root:string){async function writable(path:string){const st=await lstat(path);if(st.isSymbolicLink())return;if(st.isDirectory()){await chmod(path,0o700);for(const name of await readdir(path))await writable(join(path,name));}}await writable(root);await rm(root,{recursive:true,force:true});}
export async function recoverWorkspaces(root:string){for(const name of await readdir(root))if(/^job-[A-Za-z0-9]{6}$/.test(name))await removeWorkspace(join(root,name));}
