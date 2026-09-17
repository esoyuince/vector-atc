import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const PROVENANCE_SCHEMA_VERSION=2;
export const canonicalSourceBytes=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n?/g,'\n'),'utf8');
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceInventory(root){
 const files=[];
 function walk(dir){
  if(!fs.existsSync(path.join(root,dir)))return;
  for(const d of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
   const file=path.posix.join(dir,d.name);
   if(d.isSymbolicLink())throw Error('Source symlink is not supported: '+file);
   if(d.isDirectory())walk(file);
   else if(/\.(mjs|jsx|json|jsonc|css|md|yml|yaml)$/.test(file)&&file!=='server/build-provenance.mjs')files.push(file);
  }
 }
 for(const dir of ['src','server','docs','scripts','test','.github'])walk(dir);
 for(const file of ['package.json','package-lock.json','README.md','.gitattributes','.gitignore','wrangler.example.jsonc','index.html','vite.config.mjs','vite.config.js','vite.config.ts'])if(fs.existsSync(path.join(root,file)))files.push(file);
 const hashes=Object.fromEntries([...new Set(files)].sort().map(file=>[file,hashBytes(canonicalSourceBytes(fs.readFileSync(path.join(root,file))))]));
 return {schemaVersion:PROVENANCE_SCHEMA_VERSION,sourceFingerprint:hashBytes(JSON.stringify(hashes)),files:hashes};
}
export function verifyInventory(root,expected){
 const actual=sourceInventory(root);
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Source inventory or bytes changed since provenance generation. Run npm run build, review and refreeze; do not reuse an old run.');
 return actual;
}
