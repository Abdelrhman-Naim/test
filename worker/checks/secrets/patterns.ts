// Internal-only matches. Raw values never enter returned findings or persistence.
export function secretMatches(content:string){if(Buffer.byteLength(content)>2*1024**2)throw new Error('SECRET_INPUT_LIMIT');const matches:{value:string;index:number}[]=[];
 for(const re of [/\b(?:sb_secret_[\w-]{10,}|sk_(?:live|test)_[\w-]{10,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{30,}|xox[baprs]-[\w-]{20,}|sk-proj-[\w-]{20,})\b/g,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/:"'<>]+:[^\s@"'<>]+@[^\s"'<>]+/g])for(const m of content.matchAll(re))matches.push({value:m[0],index:m.index!});
 for(const m of content.matchAll(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g)){try{const payload=JSON.parse(Buffer.from(m[0].split('.')[1],'base64url').toString('utf8'));if(payload&&payload.role==='service_role')matches.push({value:m[0],index:m.index!});}catch{}}
 return matches.filter((m,i,a)=>a.findIndex(x=>x.value===m.value)===i);
}
export type SourceFile={path:string;content:string};
