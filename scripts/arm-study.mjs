import {armStudy} from './lib/study-operator.mjs';
const [baseUrl]=process.argv.slice(2),token=process.env.STUDY_ARM_TOKEN;if(!baseUrl)throw Error('Usage: STUDY_ARM_TOKEN=... node scripts/arm-study.mjs https://study-host');
const result=await armStudy(baseUrl,token);console.log(JSON.stringify(result));
