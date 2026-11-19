import {z} from 'zod';import {redactSecret,redactText} from '../../../packages/findings/redact';import type {RawFinding,RawToolResult} from '../../../packages/findings/schema';
export const MAX_REPORT_BYTES=50*1024**2;
export const line=z.number().int().min(1).max(10000000);export const text=z.string().min(1).max(16384);
export function failed(tool:string):RawToolResult{return {tool,state:'incomplete',findings:[]};}
export function exposure(file:string,row:number,secret:string,secrets:readonly string[]):RawFinding{
 // Unknown metadata, snippets, authors, URLs and tool-supplied Redacted fields
 // never leave the parser. Mask every known value even if it appears in a path.
 const path=redactText(file.replace(/^\/workspace\//,''),secrets).replaceAll('\\','/');if(path.startsWith('/')||path.split('/').some(p=>p==='..')||/[\x00-\x1f]/.test(path))throw new Error('REPORT_PATH');
 return {rule:'secret.exposed',category:'secret',severity:'high',location:path+':'+row,evidence:'Credential fingerprint: '+redactSecret(secret),fix:'Revoke and rotate the exposed credential, remove it from source/bundles/history and keep it server-side. No key validity was tested.'};
}
