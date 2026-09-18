import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import spec from '../docs/evaluation-spec.json' with {type:'json'};
import {validateRuleReview,SIMULATION_ASSUMPTIONS} from '../scripts/lib/rule-review.mjs';
const template=JSON.parse(fs.readFileSync(new URL('../docs/rule-review-template.json',import.meta.url)));
test('rule-review template covers every detector and declared simulator assumption without claiming approval',()=>{
 assert.deepEqual(template.rules.map(r=>r.id),spec.commandRules.map(r=>r.id));assert.deepEqual(template.simulationAssumptions.map(r=>r.id),SIMULATION_ASSUMPTIONS);assert.equal(template.status,'unreviewed');assert.equal(validateRuleReview(template).valid,false);
});
test('only a complete evidenced external review can validate',()=>{
 const review=structuredClone(template);review.status='approved';review.reviewPacketSha256='a'.repeat(64);review.reviewer={name:'External Reviewer',affiliation:'Independent',role:'aviation-domain reviewer',reviewedAt:'2026-09-18'};
 for(const row of [...review.rules,...review.simulationAssumptions]){row.decision='accepted';row.evidence=['source/page checked'];}
 assert.deepEqual(validateRuleReview(review),{valid:true,errors:[]});review.rules[0].decision='accepted-with-limitation';review.rules[0].notes=null;assert.equal(validateRuleReview(review).valid,false);review.rules[0].notes='Declared limitation';assert.equal(validateRuleReview(review).valid,true);review.rules[1].decision='rejected';assert.equal(validateRuleReview(review).valid,false);
});
