import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserCollector} from '../src/lib/browser.ts';
import {analyze} from '../src/lib/audit.ts';
import type {HttpPage} from '../src/lib/types.ts';

test('real Chromium renders SPA scripts and API data, runs axe, and blocks writing/private resources',{timeout:60000},async()=>{
 const calls:string[]=[];
 const transport=async(url:string):Promise<HttpPage>=>{
  calls.push(url);const u=new URL(url);let body='',type='text/html';
  if(u.pathname==='/')body='<!doctype html><html lang="en"><head><title>Loading</title></head><body><main id="root"></main><script src="/app.js?v=1"></script></body></html>';
  else if(u.pathname==='/app.js'){type='application/javascript';body=`document.title='Rendered Academy';document.getElementById('root').innerHTML='<h1>Real rendered heading</h1><img alt="" src="/missing.png"><button></button>';fetch('https://api.example.net/courses').then(r=>r.json()).then(d=>document.getElementById('root').insertAdjacentHTML('beforeend','<p>'+d.title+'</p>'));fetch('/mutate',{method:'POST',body:'no'}).catch(()=>{});fetch('http://127.0.0.1/private').catch(()=>{});`;}
  else if(u.hostname==='api.example.net'){type='application/json';body='{"title":"Course from API"}';}
  return {url,status:200,headers:{'content-type':type,'access-control-allow-origin':'https://app.example'},body,rawBody:Buffer.from(body),bytes:Buffer.byteLength(body),elapsedMs:10};
 };
 const collector=await createBrowserCollector({transport,executablePath:process.env.TEST_CHROMIUM_PATH??'/usr/bin/chromium'});
 try{
  const page=await collector.collect('https://app.example/','https://app.example');
  assert.ok(page.body.includes('Real rendered heading'));assert.ok(page.body.includes('Course from API'));
  assert.ok(!calls.some(u=>u.includes('127.0.0.1')||u.endsWith('/mutate')));
  assert.ok(page.browser?.requests.some(r=>r.method==='POST'&&r.blocked));
  assert.ok(page.browser?.checks.some(c=>c.rule.startsWith('axe.')&&c.status==='fail'));
  const output=analyze(page);assert.equal(output.checks.find(c=>c.rule==='seo.rendered')?.status,'pass');
  assert.ok(output.services.some(s=>s.origin==='https://api.example.net'&&s.status==='observed_request'));
  assert.ok(page.browser?.domReady!==null);
 }finally{await collector.close();}
});

test('real Chromium redirect routes stop before hop four or an internal target',{timeout:60000},async()=>{
 const calls:string[]=[];const transport=async(url:string):Promise<HttpPage>=>{calls.push(url);const u=new URL(url),hop=Number(u.pathname.slice(1))||0;return {url,status:302,headers:{location:u.pathname==='/metadata'?'http://169.254.169.254/latest/meta-data/':'/'+(hop+1)},body:'',bytes:0,elapsedMs:1};};
 const collector=await createBrowserCollector({transport,executablePath:process.env.TEST_CHROMIUM_PATH??'/usr/bin/chromium'});
 try{await assert.rejects(collector.collect('https://app.example/0','https://app.example'));assert.deepEqual(calls,['https://app.example/0','https://app.example/1','https://app.example/2','https://app.example/3']);calls.length=0;await assert.rejects(collector.collect('https://app.example/metadata','https://app.example'));assert.deepEqual(calls,['https://app.example/metadata']);}finally{await collector.close();}
});

test('real Chromium public redirect keeps final document URL and relative script base',{timeout:60000},async()=>{
 const calls:string[]=[];const transport=async(url:string):Promise<HttpPage>=>{calls.push(url);const path=new URL(url).pathname;const body=path==='/nested/final'?'<!doctype html><html lang="en"><head><title>Redirect</title></head><body><main>before</main><script src="app.js"></script></body></html>':path==='/nested/app.js'?"document.querySelector('main').textContent='redirect rendered';":'';return {url,status:path==='/start'?302:200,headers:path==='/start'?{location:'/nested/final'}:{'content-type':path.endsWith('.js')?'application/javascript':'text/html'},body,bytes:Buffer.byteLength(body),elapsedMs:1};};
 const collector=await createBrowserCollector({transport,executablePath:process.env.TEST_CHROMIUM_PATH??'/usr/bin/chromium'});
 try{const page=await collector.collect('https://app.example/start','https://app.example');assert.equal(page.url,'https://app.example/nested/final');assert.ok(page.body.includes('redirect rendered'));assert.ok(calls.includes('https://app.example/nested/app.js'));assert.ok(!calls.includes('https://app.example/app.js'));}finally{await collector.close();}
});
