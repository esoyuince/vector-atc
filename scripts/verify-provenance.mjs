import {fileURLToPath} from 'node:url';
import provenance from '../server/build-provenance.mjs';
import {verifyInventory} from './lib/source-inventory.mjs';
const checked=verifyInventory(fileURLToPath(new URL('..',import.meta.url)),provenance);
console.log(JSON.stringify({verified:true,files:Object.keys(checked.files).length,sourceFingerprint:checked.sourceFingerprint}));
