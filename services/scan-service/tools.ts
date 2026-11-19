import {GITLEAKS_FLAGS,TRUFFLEHOG_FLAGS} from './secret-arguments.mjs';
import type {ToolName} from './protocol';
// Infrastructure command recipes only. Version-specific adapters/parsers are later
// plan tasks; unparsed process output is ALWAYS incomplete and is never persisted.
export const TOOL_COMMANDS:Record<ToolName,string[]>={
 gitleaks:['node','/app/secret-step.mjs','gitleaks','git',...GITLEAKS_FLAGS],
 trufflehog:['node','/app/secret-step.mjs','trufflehog','git',...TRUFFLEHOG_FLAGS],
 semgrep:['semgrep','scan','--config=/opt/aegis/rules','--json','--metrics=off','--disable-version-check','/workspace'],
 osv:['osv-scanner','scan','source','--offline','--format=json','-r','/workspace'],
 nuclei:['nuclei','-version'] // URL execution is explicitly disabled in Task 3.
};
export const historyTool=(tool:ToolName)=>tool==='gitleaks'||tool==='trufflehog';
