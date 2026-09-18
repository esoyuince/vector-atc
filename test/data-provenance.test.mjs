import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import data from '../src/ltfm-data.json' with {type:'json'};
const listed=JSON.parse(fs.readFileSync(new URL('../docs/data-sources.json',import.meta.url)));
const hex=/^[a-f0-9]{64}$/;
function sourceIds(value,out=new Set()){
 if(Array.isArray(value))for(const item of value)sourceIds(item,out);
 else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if((key==='source'||key.endsWith('Source'))&&typeof item==='string')out.add(item);sourceIds(item,out);}
 return out;
}
test('frozen LTFM subset source hashes match the public provenance inventory',()=>{
 const byUrl=new Map(listed.map(s=>[s.url,s]));assert.equal(byUrl.size,listed.length);
 const ids=new Set();for(const source of data.sources){assert.ok(!ids.has(source.id));ids.add(source.id);assert.match(source.sha256,hex);assert.match(source.date,/^20\d\d-\d\d-\d\d$/);
  const record=byUrl.get(source.url);assert.ok(record,'missing '+source.url);assert.equal(record.sha256,source.sha256);assert.match(record.sha256,hex);assert.ok(record.bytes>0);assert.ok(source.date<=data.retrieved);}
 for(const id of sourceIds(data))assert.ok(ids.has(id),'unknown source id '+id);
});
test('provenance inventory has unique immutable identifiers',()=>{
 assert.equal(new Set(listed.map(s=>s.sha256)).size,listed.length);assert.ok(listed.every(s=>hex.test(s.sha256)&&Number.isSafeInteger(s.bytes)&&s.bytes>0));
 assert.equal(data.id,'LTFM-SOUTH-v2');assert.match(data.retrieved,/^20\d\d-\d\d-\d\d$/);
});
test('committed DHMI download receipt proves exact byte/hash availability without claiming content adjudication',()=>{
 const receipt=JSON.parse(fs.readFileSync(new URL('../docs/source-verification-receipt.json',import.meta.url))),byName=new Map(listed.map(s=>[s.name,s]));assert.equal(receipt.allMatch,true);assert.equal(receipt.contentAdjudication,false);assert.equal(receipt.providerCalls,0);assert.ok(Number.isFinite(Date.parse(receipt.verifiedAt)));assert.equal(receipt.results.length,listed.length);
 for(const row of receipt.results){const source=byName.get(row.name);assert.ok(source);assert.equal(row.url,source.url);assert.equal(row.expectedBytes,source.bytes);assert.equal(row.actualBytes,source.bytes);assert.equal(row.expectedSha256,source.sha256);assert.equal(row.actualSha256,source.sha256);assert.equal(row.bytesMatch,true);assert.equal(row.sha256Match,true);}
});
test('machine-assisted aviation value receipt stays aligned with frozen data and does not claim domain review',()=>{
 const receipt=JSON.parse(fs.readFileSync(new URL('../docs/source-value-verification-receipt.json',import.meta.url))),sourceBytes=fs.readFileSync(new URL('../docs/source-verification-receipt.json',import.meta.url));assert.equal(receipt.sourceFileVerificationReceiptSha256,createHash('sha256').update(sourceBytes).digest('hex'));assert.equal(receipt.dataset,data.id);assert.equal(receipt.contentAdjudication,false);assert.equal(receipt.externalDomainReview,false);assert.equal(receipt.spatialChartReviewStillRequired,true);assert.equal(receipt.providerCalls,0);assert.equal(receipt.checks.length,10);assert.equal(new Set(receipt.checks.map(c=>c.id)).size,10);assert.ok(receipt.checks.every(c=>c.status==='verified-direct-text'&&c.page===1));
 const byId=Object.fromEntries(receipt.checks.map(c=>[c.id,c])),holds=Object.fromEntries(data.holds.map(h=>[h.fix,h]));for(const id of ['hold-fm166','hold-irded','hold-tibnu']){const c=byId[id];assert.equal(holds[c.claim.fix].minAltitude,c.claim.minAltitude);assert.equal(holds[c.claim.fix].maxSpeed,c.claim.maxSpeed);assert.equal(holds[c.claim.fix].source,c.sourceId);}
 const gradient=byId['sid-gradient-304-8000'];for(const p of Object.values(data.procedures).filter(p=>p.kind==='SID')){assert.equal(p.minClimbFtPerNm,gradient.claim.minClimbFtPerNm);assert.equal(p.climbGradientUntil,gradient.claim.climbGradientUntil);assert.equal(p.gradientSource,gradient.sourceId);}
 for(const id of ['sid-fm047-first-leg','sid-fm051-first-leg','sid-fm072-first-leg']){const c=byId[id],legs=Object.values(data.procedures).filter(p=>p.kind==='SID'&&p.legs[0].fix===c.claim.fix).map(p=>p.legs[0]);assert.ok(legs.length);assert.ok(legs.every(l=>l.minAltitude===c.claim.minAltitude&&l.maxSpeed===c.claim.maxSpeed));}
 for(const id of ['fap-floor-nedba','fap-floor-usrof','fap-floor-avteq']){const c=byId[id],apps=Object.values(data.procedures).filter(p=>p.kind==='APP'&&p.fap===c.claim.fix);assert.ok(apps.length);assert.ok(apps.every(p=>p.legs.find(l=>l.fix===p.fap).altitude===c.claim.altitude));}
 assert.deepEqual(receipt.manualReview.map(r=>r.id).sort(),['holding-course-turn-geometry','star-constraint-to-fix-mapping','transition-hold-speed-gazge-insta-ulqal']);assert.ok(receipt.manualReview.every(r=>r.status==='manual-visual-review-required'));
});
