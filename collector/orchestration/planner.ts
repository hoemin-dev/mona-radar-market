export const PRACTICAL_LOWER_BOUND = "2001-01-01T00:00:00";
export const DISCOVERY_CHUNK_MINUTES = 24 * 60;
export const INCREMENTAL_OVERLAP_MINUTES = 24 * 60;
export const LONG_RANGE_CONFIRMATION_DAYS = 31;

export interface LocalRange { readonly start: string; readonly end: string; }
export interface CollectionPlan {
  readonly mode: "initial" | "incremental";
  readonly requestedRange: LocalRange | null;
  readonly effectiveRange: LocalRange;
  readonly checkpoint: string | null;
  readonly overlapMinutes: number;
  readonly chunkMinutes: number;
  readonly chunkCount: number;
  readonly operations: readonly string[];
  readonly productionEffectiveRange?: LocalRange;
}

function parseLocal(value:string):number {
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/u.exec(value);
  if(!m) throw new Error(`Invalid KST local datetime: ${value}`);
  const time=Date.UTC(+m[1]!,+m[2]!-1,+m[3]!,+m[4]!,+m[5]!,+m[6]!);
  if(new Date(time).toISOString().slice(0,19)!==value) throw new Error(`Invalid KST local datetime: ${value}`);
  return time;
}
function formatLocal(time:number):string { return new Date(time).toISOString().slice(0,19); }
export function kstNow(now=new Date()):string { return new Date(now.getTime()+9*60*60*1000).toISOString().slice(0,19); }
export function queryMinute(value:string):string { return value.replace(/[-T:]/gu,"").slice(0,12); }

export function initialRange(startDate:string,endDate:string,now=new Date()):LocalRange {
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/u.test(endDate)) throw new Error("Initial dates must use YYYY-MM-DD");
  const range={start:`${startDate}T00:00:00`,end:`${endDate}T23:59:00`};
  const start=parseLocal(range.start), end=parseLocal(range.end), lower=parseLocal(PRACTICAL_LOWER_BOUND), current=parseLocal(kstNow(now));
  if(start<lower) throw new Error("INITIAL_RANGE_BEFORE_2001_LOWER_BOUND");
  if(start>end) throw new Error("INITIAL_RANGE_START_AFTER_END");
  if(end>current) throw new Error("INITIAL_RANGE_END_IN_FUTURE_KST");
  return range;
}

export function initialDateTimeRange(startValue:string,endValue:string,now=new Date()):LocalRange {
  const minute=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;
  if(!minute.test(startValue)||!minute.test(endValue))throw new Error("Initial datetimes must use YYYY-MM-DDTHH:mm");
  const range={start:`${startValue}:00`,end:`${endValue}:00`};
  const start=parseLocal(range.start),end=parseLocal(range.end),lower=parseLocal(PRACTICAL_LOWER_BOUND),current=parseLocal(kstNow(now));
  if(start<lower)throw new Error("INITIAL_RANGE_BEFORE_2001_LOWER_BOUND");
  if(start>end)throw new Error("INITIAL_RANGE_START_AFTER_END");
  if(end>current)throw new Error("INITIAL_RANGE_END_IN_FUTURE_KST");
  return range;
}

export function incrementalRange(checkpoint:string|undefined,now=new Date()):LocalRange {
  if(!checkpoint) throw new Error("INITIAL_RANGE_REQUIRED");
  const lower=parseLocal(PRACTICAL_LOWER_BOUND), through=parseLocal(checkpoint), end=parseLocal(kstNow(now));
  return {start:formatLocal(Math.max(lower,through-INCREMENTAL_OVERLAP_MINUTES*60_000)),end:formatLocal(end-end%60_000)};
}
export function incrementalSmokeRange(production:LocalRange,checkpoint:string,start:string,end:string,now=new Date()):LocalRange {
  const smoke=initialDateTimeRange(start,end,now);
  if(smoke.start>checkpoint||smoke.end<checkpoint)throw new Error("INCREMENTAL_SMOKE_RANGE_MUST_INCLUDE_CHECKPOINT");
  if(smoke.start<production.start||smoke.end>production.end)throw new Error("INCREMENTAL_SMOKE_RANGE_OUTSIDE_PRODUCTION_RANGE");
  return smoke;
}
export function rangeMinutes(range:LocalRange):number { return Math.floor((parseLocal(range.end)-parseLocal(range.start))/60_000)+1; }
export function chunkCount(range:LocalRange):number { return Math.ceil(rangeMinutes(range)/DISCOVERY_CHUNK_MINUTES); }
export function* chunks(range:LocalRange):Generator<LocalRange> {
  let cursor=parseLocal(range.start); const end=parseLocal(range.end); const span=DISCOVERY_CHUNK_MINUTES*60_000;
  while(cursor<=end){ const chunkEnd=Math.min(end,cursor+span-60_000); yield {start:formatLocal(cursor),end:formatLocal(chunkEnd)}; cursor=chunkEnd+60_000; }
}
export function assertLongRangeAllowed(range:LocalRange,allow:boolean):void {
  if(rangeMinutes(range)>LONG_RANGE_CONFIRMATION_DAYS*1440&&!allow) throw new Error("LONG_RANGE_CONFIRMATION_REQUIRED");
}
