import type { ScanResult, Finding as LegacyFinding } from './types';
import { normalize } from '../../packages/findings/normalizer';
import { redactText } from '../../packages/findings/redact';
import type { RawToolResult, Suppression } from '../../packages/findings/schema';
export function legacyLocation(f: LegacyFinding) { return f.file ? f.file + ':' + (f.line ?? 1) : ['security.api-auth', 'security.supabase-rls'].includes(f.rule) ? f.url + '#case=' + encodeURIComponent(f.id) : f.url; }
function redactValue<T>(value: T): T { if (typeof value === 'string')
    return redactText(value) as T; if (Array.isArray(value))
    return value.map(redactValue) as T; if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v)])) as T; return value; }
const key = (rule: string, category: string, location: string, evidence: string) => JSON.stringify([rule, category, location.replaceAll('\\', '/').replace(/^\.\//, '').replace(/#L(\d+)$/, ':$1'), evidence]);
/** Worker persistence boundary: detectors and the UI's legacy fields keep their semantics. */
export function normalizeLegacyResult(result: ScanResult, suppressions: Suppression[] = []): ScanResult {
    const safe = redactValue(result), originals = new Map<string, LegacyFinding>(), custom: RawToolResult = { tool: 'custom', state: safe.errors.length || safe.repository?.failed || safe.repository?.pending || safe.repository?.truncated || safe.runtimeSecurity?.status==='unavailable' || safe.apiHttp?.status==='partial' || safe.checks?.some(c=>c.status==='unavailable'&&c.unavailableReason==='collection_error') ? 'incomplete' : 'ok', findings: [] }, osv: RawToolResult = { tool: 'osv', state: safe.dependencyAudit?.status === 'completed' ? 'ok' : 'incomplete', findings: [] };
    for (const f of safe.findings) {
        if(f.rule.startsWith('secret.'))continue;
        const location = legacyLocation(f);
        originals.set(key(f.rule, f.category, location, f.evidence), f);
        (f.rule.startsWith('repo.osv.') ? osv : custom).findings.push({ rule: f.rule, category: f.category, severity: f.severity, location, evidence: f.evidence, fix: f.recommendation, context: f.security?.basis === 'configuration' });
    }
    const tools = [custom];
    if (osv.findings.length || safe.dependencyAudit && safe.dependencyAudit.status !== 'not_enabled')
        tools.push(osv);
    if(safe.deepTools)for(const r of safe.deepTools.results)tools.push({tool:'scan-service/'+r.tool,state:r.state,findings:r.findings.map(f=>{if(f.category!=='secret')return f;const prior=safe.findings.find(old=>['repo.secret','security.secret'].includes(old.rule)&&(legacyLocation(old)===f.location||old.rule==='security.secret'&&f.location.replace(/:\d+$/,'')===old.url));return prior?{...f,rule:prior.rule,category:prior.category,location:legacyLocation(prior),evidence:prior.evidence}:f;})});
    for(const source of safe.secretTools??[])tools.push({...source,findings:source.findings.map(f=>{if(f.category!=='secret')return f;const prior=safe.findings.find(old=>(f.rule==='secret.next-public'?old.rule==='repo.public-secret':['repo.secret','security.secret'].includes(old.rule))&&(legacyLocation(old)===f.location||old.rule==='security.secret'&&f.location.replace(/:\d+$/,'')===old.url));if(prior)return {...f,rule:prior.rule,category:prior.category,location:legacyLocation(prior),evidence:prior.evidence};return f;})});
    const normalized = normalize(tools, suppressions);
    const findings = normalized.findings.flatMap(n => { const legacy = originals.get(key(n.rule, n.category, n.location, n.redactedEvidence)); if(legacy)return [{ ...legacy, evidence: n.redactedEvidence, recommendation: n.fix }];if(n.category!=='secret')return [];
        const location=n.location.match(/^(.*):(\d+)$/),path=location?.[1]??n.location,line=location?Number(location[2]):undefined,isUrl=/^https?:\/\//.test(path);return [{id:n.id,rule:n.rule,category:'security' as const,severity:n.severity,confidence:'high' as const,title:'كشف سر محتمل — '+n.tool,description:'مطابقة محلية أو نتيجة أداة؛ لم تختبر صلاحية المفتاح.',url:isUrl?path:safe.scope,evidence:n.redactedEvidence,recommendation:n.fix,checks:['دوّر السر عند تأكيد التعرض ثم أعد الفحص.'],security:{group:'secrets' as const,basis:'indicator' as const,method:'مطابقة محلية من المصدر أو تقرير أداة دون التحقق الشبكي من المفتاح.',impact:'قد يتيح السر المكشوف وصولًا غير مخول إن كان صالحًا.',fixSteps:[n.fix],verification:['أعد الفحص بعد تدوير السر وإزالة التعرض.'],references:[]},...(!isUrl?{file:path,line}:{})}]; });
    return { ...safe, findings, normalizedFindings: normalized.findings, findingNormalization: { version: 1, toolStatus: normalized.toolStatus } };
}

export function failedWorkerResult(scoreVersion:string):ScanResult{return normalizeLegacyResult({findings:[],services:[],coverage:[],pages:[],errors:['تعطل عامل الجمع؛ راجع تشخيص المحرك.'],scope:'',engine:'aegis-link-audit@0.8.0',scoreVersion,checks:[]});}
