export const HISTORICAL_REQUEST_INTERVAL_MS=500;
export interface RequestPacer { beforeAttempt():Promise<void>; }
export function createRequestPacer(options:{minimumIntervalMs?:number;now?:()=>number;sleep?:(ms:number)=>Promise<void>}={}):RequestPacer {
  const interval=options.minimumIntervalMs??HISTORICAL_REQUEST_INTERVAL_MS,now=options.now??Date.now,sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));let lastStart:number|undefined;
  return {async beforeAttempt(){const current=now();const wait=lastStart===undefined?0:Math.max(0,interval-(current-lastStart));if(wait)await sleep(wait);lastStart=now();}};
}
