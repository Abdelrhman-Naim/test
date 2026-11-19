import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import type {CDPSession} from 'playwright';
import * as browser from '../src/lib/browser';import type {HttpPage} from '../src/lib/types';
test('CDP interception guards each redirect, retains native URL semantics and never continues network',{timeout:3000},async()=>{
 const seen:string[]=[],commands:{method:string;params?:Record<string,unknown>}[]=[];const events=new EventEmitter();const session=Object.assign(events,{send:async(method:string,params?:Record<string,unknown>)=>{commands.push({method,params});if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main'}}};return {};}}) as unknown as CDPSession;
 assert.equal(typeof browser.installGuardedRoutes,'function');const remove=await browser.installGuardedRoutes(session,async route=>{seen.push(route.request().url());await route.fulfill({status:302,headers:{location:'/next'},body:Buffer.alloc(0)});});
 try{for(let hop=0;hop<5;hop++){events.emit('Fetch.requestPaused',{requestId:'r'+hop,redirectedRequestId:hop?'r'+(hop-1):undefined,frameId:'main',resourceType:'Document',request:{url:'https://example.com/'+hop,method:'GET',headers:{}}});await new Promise(ok=>setImmediate(ok));}
 assert.deepEqual(seen,['https://example.com/0','https://example.com/1','https://example.com/2','https://example.com/3']);assert.equal(commands.filter(c=>c.method==='Fetch.fulfillRequest').length,4);assert.ok(commands.some(c=>c.method==='Fetch.failRequest'&&c.params?.requestId==='r4'));assert.ok(!commands.some(c=>c.method==='Fetch.continueRequest'));
 }finally{remove();}
});
