import fs from 'node:fs';import path from 'node:path';import {canonicalSourceBytes,hashBytes} from './source-inventory.mjs';
export const STUDY_PROTOCOL_FILES=['docs/methodology.md','docs/evaluation-spec.json','docs/study-design.md','docs/study-operations.md','docs/simulation-policy-v2.md','docs/data-sources.json','docs/source-verification-receipt.json','docs/rule-review-guide.md','src/ltfm-data.json'];
export function protocolSnapshot(root){
 return STUDY_PROTOCOL_FILES.map(file=>{const bytes=canonicalSourceBytes(fs.readFileSync(path.join(root,file)));return {file,bytes:bytes.length,sha256:hashBytes(bytes),content:bytes};});
}
export function writeProtocolSnapshot(root,destination){
 const entries=protocolSnapshot(root);for(const e of entries){const out=path.join(destination,e.file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,e.content,{flag:'wx'});}return entries.map(({content,...e})=>e);
}
export function verifyProtocolSnapshot(root,destination,expected){
 const source=protocolSnapshot(root).map(({content,...e})=>e);if(JSON.stringify(source)!==JSON.stringify(expected))throw Error('Protocol source descriptor mismatch');
 for(const e of expected){const file=path.join(destination,e.file);if(!fs.existsSync(file))throw Error('Missing protocol snapshot '+e.file);const bytes=fs.readFileSync(file);if(bytes.length!==e.bytes||hashBytes(bytes)!==e.sha256)throw Error('Protocol snapshot mismatch '+e.file);}
 return source;
}
