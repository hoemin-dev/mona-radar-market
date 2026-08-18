import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { KonepsClient } from "../koneps/client.js";
import { loadKonepsConfig } from "../koneps/config.js";
import { DEFAULT_MARKET_DB_PATH, openMarketDatabase } from "../storage/database.js";
import { runManualCollection } from "./collector.js";
import { assertLongRangeAllowed, chunkCount, initialDateTimeRange, initialRange, incrementalRange, incrementalSmokeRange, INCREMENTAL_OVERLAP_MINUTES, DISCOVERY_CHUNK_MINUTES, type CollectionPlan } from "./planner.js";
import { checkpoint } from "./state.js";
import { acquireCollectorLease, releaseCollectorLease } from "./historical-state.js";
import { randomUUID } from "node:crypto";

export interface ManualCliArgs { readonly mode:"initial"|"incremental"; readonly start?:string; readonly end?:string; readonly startDatetime?:string; readonly endDatetime?:string; readonly smokeStartDatetime?:string; readonly smokeEndDatetime?:string; readonly execute:boolean; readonly allowLongRange:boolean; readonly databasePath:string; readonly smokeMaxNotices?:number; readonly smokeMaxApiCalls?:number; }
function value(argv:readonly string[],name:string):string|undefined { const i=argv.indexOf(name); if(i<0)return undefined; const v=argv[i+1]; if(!v||v.startsWith("--"))throw new Error(`${name} requires a value`); return v; }
export function parseManualCliArgs(argv:readonly string[]):ManualCliArgs {
  const mode=argv[0]; if(mode!=="initial"&&mode!=="incremental")throw new Error("mode must be initial or incremental");
  const start=value(argv,"--start"),end=value(argv,"--end"),startDatetime=value(argv,"--start-datetime"),endDatetime=value(argv,"--end-datetime"),smokeStartDatetime=value(argv,"--smoke-start-datetime"),smokeEndDatetime=value(argv,"--smoke-end-datetime");
  const datePair=!!start&&!!end,datetimePair=!!startDatetime&&!!endDatetime;
  if(mode==="initial"&&datePair===datetimePair)throw new Error("initial mode requires exactly one complete date or datetime range");
  if(mode==="incremental"&&(start||end||startDatetime||endDatetime))throw new Error("incremental mode does not accept a production range");
  if((smokeStartDatetime===undefined)!==(smokeEndDatetime===undefined))throw new Error("incremental smoke start/end must be supplied together");
  if(mode!=="incremental"&&(smokeStartDatetime||smokeEndDatetime))throw new Error("smoke start/end overrides are incremental-only");
  const numberOption=(name:string)=>{const raw=value(argv,name);if(raw===undefined)return undefined;const parsed=Number(raw);if(!Number.isInteger(parsed)||parsed<1)throw new Error(`${name} must be a positive integer`);return parsed;};
  const smokeMaxNotices=numberOption("--smoke-max-notices"),smokeMaxApiCalls=numberOption("--smoke-max-api-calls");
  if((smokeMaxNotices===undefined)!==(smokeMaxApiCalls===undefined))throw new Error("smoke limits must be supplied together");
  if(smokeStartDatetime&&smokeMaxNotices===undefined)throw new Error("incremental smoke range requires smoke safety limits");
  return {mode,start,end,startDatetime,endDatetime,smokeStartDatetime,smokeEndDatetime,execute:argv.includes("--execute"),allowLongRange:argv.includes("--allow-long-range"),databasePath:value(argv,"--database")??DEFAULT_MARKET_DB_PATH,smokeMaxNotices,smokeMaxApiCalls};
}
function readCheckpoint(path:string):string|undefined {
  if(!existsSync(path))return undefined;
  const db=new DatabaseSync(path,{readOnly:true}); try{return checkpoint(db);}catch{return undefined;}finally{db.close();}
}
export function buildCliPlan(args:ManualCliArgs,now=new Date()):CollectionPlan {
  const cp=args.mode==="incremental"?readCheckpoint(args.databasePath):undefined;
  const productionEffective=args.mode==="initial"?null:incrementalRange(cp,now);
  let effective=args.mode==="initial"?(args.startDatetime?initialDateTimeRange(args.startDatetime,args.endDatetime!,now):initialRange(args.start!,args.end!,now)):productionEffective!;
  if(args.smokeStartDatetime){
    effective=incrementalSmokeRange(productionEffective!,cp!,args.smokeStartDatetime,args.smokeEndDatetime!,now);
  }
  assertLongRangeAllowed(effective,args.allowLongRange);
  return {mode:args.mode,requestedRange:args.mode==="initial"?effective:null,effectiveRange:effective,checkpoint:cp??null,overlapMinutes:args.mode==="incremental"?INCREMENTAL_OVERLAP_MINUTES:0,chunkMinutes:DISCOVERY_CHUNK_MINUTES,chunkCount:chunkCount(effective),operations:["getBidPblancListInfoThngPPSSrch","getBidPblancListInfoThngPurchsObjPrdct","getBidPblancListInfoThngBsisAmount"],...(productionEffective&&args.smokeStartDatetime?{productionEffectiveRange:productionEffective}:{})};
}
async function main():Promise<void>{
  const args=parseManualCliArgs(process.argv.slice(2)); const plan=buildCliPlan(args);
  console.log(JSON.stringify({dryRun:!args.execute,databaseMutation:args.execute,apiCalls:args.execute?`bounded by ${args.smokeMaxApiCalls??"collection scope"}`:0,databasePath:args.databasePath,smokeLimits:args.smokeMaxNotices===undefined?null:{maxNotices:args.smokeMaxNotices,maxApiCalls:args.smokeMaxApiCalls},...plan},null,2));
  if(!args.execute)return;
  const database=openMarketDatabase(args.databasePath);
  const token=randomUUID();
  try{acquireCollectorLease(database,{token,mode:"manual",now:new Date()});const loaded=loadKonepsConfig();const config=args.smokeMaxApiCalls===undefined?loaded:{...loaded,maxRetries:0};const result=await runManualCollection({database,client:new KonepsClient({config}),plan,maxApiCalls:args.smokeMaxApiCalls,maxDiscoveredNotices:args.smokeMaxNotices,onProgress:(p)=>console.log(JSON.stringify({progress:p}))}); console.log(JSON.stringify(result,null,2));}
  finally{try{releaseCollectorLease(database,token);}catch{}database.close();}
}
if(process.argv[1]?.endsWith("cli.js"))main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Manual collector failed");process.exitCode=1;});
