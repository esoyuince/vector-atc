import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {parseStudyManifest} from '../server/study-run.mjs';import {validateRuleReview} from './lib/rule-review.mjs';
const [manifestPath,reviewPath,out]=process.argv.slice(2);if(!manifestPath||!reviewPath||!out)throw Error('Usage: node scripts/attach-rule-review.mjs FROZEN_MANIFEST REVIEW_JSON NEW_MANIFEST');
const root=fileURLToPath(new URL('..',import.meta.url)),relative=path.relative(root,path.resolve(out));if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('Finalized manifest output must be outside the source repository.');
if(fs.existsSync(out))throw Error('Refusing to overwrite finalized manifest');const manifest=parseStudyManifest(fs.readFileSync(manifestPath,'utf8')),reviewBytes=fs.readFileSync(reviewPath),review=JSON.parse(reviewBytes);
const checked=validateRuleReview(review);if(!checked.valid)throw Error('Rule review is incomplete: '+checked.errors.join('; '));const ruleReviewSha256=createHash('sha256').update(reviewBytes).digest('hex');
const finalized={...manifest,independentRuleReview:true,ruleReviewSha256};parseStudyManifest(finalized);fs.writeFileSync(out,JSON.stringify(finalized,null,2),{flag:'wx'});console.log(JSON.stringify({finalized:true,runId:finalized.runId,ruleReviewSha256}));
