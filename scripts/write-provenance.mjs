import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceInventory} from './lib/source-inventory.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),value=sourceInventory(root);
fs.writeFileSync(path.join(root,'server/build-provenance.mjs'),'// Generated from source bytes; no credentials or timestamps.\nexport default '+JSON.stringify(value,null,2)+';\n');
console.log('SOURCE_FINGERPRINT',value.sourceFingerprint);
