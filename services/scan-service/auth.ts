import {createHmac,timingSafeEqual} from 'node:crypto';
export function sign(secret:string,timestamp:string,rawBody:string|Buffer){return createHmac('sha256',secret).update(timestamp+'.').update(rawBody).digest('hex');}
export function authenticate(secret:string,timestamp:string|undefined,signature:string|undefined,body:Buffer,now=Date.now()){
 if(secret.length<32||!timestamp||!/^\d{13}$/.test(timestamp)||!signature||!/^([a-f0-9]{64})$/.test(signature)||Math.abs(now-Number(timestamp))>60000)throw new Error('UNAUTHORIZED');
 if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(secret,timestamp,body),'hex')))throw new Error('UNAUTHORIZED');
}
