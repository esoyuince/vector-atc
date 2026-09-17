const sinks=new WeakMap();
export function emitObservation(sim,event){const sink=sinks.get(sim);if(sink)sink.push(structuredClone(event));}
export function collectObservations(sim,fn){const old=sinks.get(sim),events=[];sinks.set(sim,events);try{return {value:fn(),events};}finally{if(old)sinks.set(sim,old);else sinks.delete(sim);}}
