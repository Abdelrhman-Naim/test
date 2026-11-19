import type {ScanResult} from './types';import type {Finding,RawToolResult} from '../../packages/findings/schema';
export function addSecretResults(result:ScanResult,tool:string,findings:Finding[],state:RawToolResult['state']='ok'){
 result.secretTools??=[];let target=result.secretTools.find(r=>r.tool===tool);if(!target){target={tool,state,findings:[]};result.secretTools.push(target);}if(state!=='ok')target.state='incomplete';
 for(const f of findings)if(!target.findings.some(old=>old.rule===f.rule&&old.location===f.location&&old.evidence===f.redactedEvidence)){if(target.findings.length>=1000){target.state='incomplete';break;}target.findings.push({rule:f.rule,category:f.category,severity:f.severity,location:f.location,evidence:f.redactedEvidence,fix:f.fix});}
}
