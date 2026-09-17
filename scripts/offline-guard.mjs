// Preload for tests and offline tools. Fabricated fetch implementations still work.
// Real external TCP/UDP and fetch calls fail before dispatch; loopback QA is allowed.
import net from 'node:net';
import dgram from 'node:dgram';
const local=host=>['127.0.0.1','localhost','::1','[::1]'].includes(String(host).toLowerCase());
const denied=()=>{throw Error('OFFLINE_GUARD: external network access denied');};
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!local(url.hostname))return Promise.reject(Error('OFFLINE_GUARD: external fetch denied'));return originalFetch(input,options);};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const first=Array.isArray(args[0])?args[0][0]:args[0];
 const host=typeof first==='object'?(first.host??'localhost'):typeof args[1]==='string'?args[1]:'localhost';
 if(typeof first==='object'&&first.path)return connect.apply(this,args); // local IPC
 if(!local(host))return denied();return connect.apply(this,args);
};
dgram.Socket.prototype.send=denied;
for(const key of Object.keys(process.env))if(/^(TYPESAFE_API_KEY|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|CF_API_TOKEN)$/.test(key))delete process.env[key];
process.env.WRANGLER_SEND_METRICS='false';
const preload='--import='+import.meta.url;
if(!(process.env.NODE_OPTIONS||'').includes(preload))process.env.NODE_OPTIONS=((process.env.NODE_OPTIONS||'')+' '+preload).trim();
