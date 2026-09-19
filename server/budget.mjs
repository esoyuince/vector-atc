// $0.1596/day at $0.042/M input tokens: $4.788 over 30 UTC days.
export const DEFAULT_LIMITS={dailyTokens:3800000,hourlyRequests:720,intervalMs:60000};
export function budgetAt(budget,now){const day=new Date(now).toISOString().slice(0,10),hour=Math.floor(now/3600000);return {day,hour,tokens:budget?.day===day?budget.tokens:0,requests:budget?.hour===hour?budget.requests:0,actualTokens:budget?.day===day?budget.actualTokens:0,totalCalls:budget?.totalCalls||0};}
export function reserveBudget(budget,now,reserve,limits=DEFAULT_LIMITS){const next=budgetAt(budget,now);if(!Number.isSafeInteger(reserve)||reserve<=0||!Number.isSafeInteger(next.tokens+reserve)||(limits.dailyTokens!==null&&next.tokens+reserve>limits.dailyTokens)||next.requests>=limits.hourlyRequests)return null;return {...next,tokens:next.tokens+reserve,requests:next.requests+1,totalCalls:next.totalCalls+1};}
export function settleBudget(budget,reservation,reserved,actual,now){const next=budgetAt(budget,now);if(next.day===reservation.day&&Number.isSafeInteger(actual)&&actual>=0){next.tokens-=reserved-actual;next.actualTokens+=actual;}return next;}

export function dailyTokenLimit(value,providerBalanceAllowed=false){
 if(providerBalanceAllowed&&value!=='provider-balance')throw Error('Frozen provider-balance policy requires matching runtime configuration');
 if(value==='provider-balance'){
  if(!providerBalanceAllowed)throw Error('Provider-balance requires an explicit frozen collection manifest');
  return null;
 }
 const n=Number(value);return Number.isSafeInteger(n)&&n>=10000&&n<=100000000?n:DEFAULT_LIMITS.dailyTokens;
}
