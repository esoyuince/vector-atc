import {execFileSync} from 'node:child_process';
const run=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export function gitSourceState(root,{requireClean=true}={}){
 const status=run(root,['status','--porcelain=v1','--untracked-files=normal']);
 if(requireClean&&status)throw Error('Study artifacts require a clean Git working tree');
 const commit=run(root,['rev-parse','HEAD']),tree=run(root,['rev-parse','HEAD^{tree}']);
 if(!/^[a-f0-9]{40}$/.test(commit)||!/^[a-f0-9]{40}$/.test(tree))throw Error('Invalid Git source identity');
 return {commit,tree,clean:!status,dirtyEntries:status?status.split(/\r?\n/).filter(Boolean).length:0};
}
