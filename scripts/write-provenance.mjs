import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),files=[];
function walk(dir){for(const d of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const f=path.posix.join(dir,d.name);if(d.isDirectory())walk(f);else if(/\.(mjs|jsx|json|css|md)$/.test(f)&&f!=='server/build-provenance.mjs')files.push(f);}}
for(const d of ['src','server','docs','scripts','test'])walk(d);files.push('package.json','package-lock.json','README.md');
const hashes=Object.fromEntries([...new Set(files)].sort().map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const value={schemaVersion:1,sourceFingerprint:hash(JSON.stringify(hashes)),files:hashes};
fs.writeFileSync(path.join(root,'server/build-provenance.mjs'),'// Generated from source bytes; no credentials or timestamps.\nexport default '+JSON.stringify(value,null,2)+';\n');console.log('SOURCE_FINGERPRINT',value.sourceFingerprint);
