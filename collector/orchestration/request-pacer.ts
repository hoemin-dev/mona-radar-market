export const HISTORICAL_REQUEST_INTERVAL_MS=2_000;
export const INITIAL_RATE_LIMIT_DELAYS_MS=[60_000,180_000,300_000] as const;
export interface RequestPacer { beforeAttempt():Promise<void>; imposeCooldown(milliseconds:number):void; }
export function createRequestPacer(options:{minimumIntervalMs?:number;now?:()=>number;sleep?:(ms:number)=>Promise<void>}={}):RequestPacer {
  const interval=options.minimumIntervalMs??HISTORICAL_REQUEST_INTERVAL_MS,now=options.now??Date.now,sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));let lastStart:number|undefined,cooldownUntil=0,queue=Promise.resolve();
  return {
    beforeAttempt(){
      const turn=queue.then(async()=>{const current=now();const intervalReady=lastStart===undefined?current:lastStart+interval;const wait=Math.max(0,intervalReady-current,cooldownUntil-current);if(wait)await sleep(wait);lastStart=now();});
      queue=turn.catch(()=>undefined);
      return turn;
    },
    imposeCooldown(milliseconds){cooldownUntil=Math.max(cooldownUntil,now()+milliseconds);},
  };
}
