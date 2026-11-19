// Return only a boolean; diagnostic values may contain credentials. Never echo.
export function trufflehogCompleted(stderr,version){let completed=false;for(const line of stderr.split(/\r?\n/).filter(l=>l.trim())){let row;try{row=JSON.parse(line);}catch{return false;}if(!row||typeof row!=='object'||!/^info-\d+$|^debug$/.test(row.level??''))return false;
 for(const [key,value]of Object.entries(row)){if(/^(?:error|errors|err)$/i.test(key)&&value!==null&&value!==undefined&&value!==''&&value!==0&&!(Array.isArray(value)&&value.length===0))return false;if(/^(?:msg|stderr)$/i.test(key)&&typeof value==='string'&&/\b(?:errors?|fatal|failed|failure|panic)\b/i.test(value))return false;}
 if(row.msg==='finished scanning'&&String(row.trufflehog_version).replace(/^v/,'')===version)completed=true;
 }return completed;}
