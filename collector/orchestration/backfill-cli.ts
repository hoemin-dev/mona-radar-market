import { openMarketDatabase, DEFAULT_MARKET_DB_PATH } from "../storage/database.js";
import { createHistoricalJob, historicalStatus, prepareHistoricalResume, previewHistoricalNextChunk, requestHistoricalStop, acquireCollectorLease, releaseCollectorLease } from "./historical-state.js";
import { kstNow } from "./planner.js";
import { randomUUID } from "node:crypto";
import { KonepsClient } from "../koneps/client.js";
import { loadKonepsConfig } from "../koneps/config.js";
import { createRequestPacer, HISTORICAL_REQUEST_INTERVAL_MS, INITIAL_RATE_LIMIT_DELAYS_MS } from "./request-pacer.js";
import { runHistoricalDiscovery } from "./historical-executor.js";

function value(argv:readonly string[],name:string):string|undefined {const i=argv.indexOf(name);if(i<0)return undefined;const v=argv[i+1];if(!v||v.startsWith("--"))throw new Error(`${name} requires a value`);return v;}
async function main():Promise<void> {const argv=process.argv.slice(2),command=argv[0],path=value(argv,"--database")??DEFAULT_MARKET_DB_PATH,now=new Date(),db=openMarketDatabase(path);try{
  if(command==="create"){const start=value(argv,"--start"),cutoff=value(argv,"--cutoff")??kstNow(now).slice(0,16);if(!start)throw new Error("--start is required");const job=createHistoricalJob(db,{start,cutoff,now});console.log(JSON.stringify({jobId:job.jobId,status:job.status,start:job.startBoundary,cutoff:job.cutoffBoundary,apiCalls:0},null,2));return;}
  const jobId=value(argv,"--job");if(!jobId)throw new Error("--job is required");
  if(command==="status"){console.log(JSON.stringify(historicalStatus(db,jobId,now)??{jobId,found:false,apiCalls:0},null,2));return;}
  if(command==="stop"){const job=requestHistoricalStop(db,jobId,now);console.log(JSON.stringify({jobId:job.jobId,status:job.status,stopRequested:job.stopRequested,apiCalls:0},null,2));return;}
  if(command==="resume"){const token=randomUUID();acquireCollectorLease(db,{token,mode:"historical",jobId,now});try{const prepared=prepareHistoricalResume(db,jobId,now);console.log(JSON.stringify({jobId,status:prepared.job.status,successfulThrough:prepared.job.successfulThrough,nextChunk:prepared.chunk,executionAttached:false,apiCalls:0},null,2));}finally{releaseCollectorLease(db,token);}return;}
  if(command==="run"){const maxChunks=Number(value(argv,"--max-chunks")??1),maxApiCalls=Number(value(argv,"--max-api-calls")??20);if(!Number.isInteger(maxChunks)||maxChunks<1||!Number.isInteger(maxApiCalls)||maxApiCalls<1)throw new Error("--max-chunks and --max-api-calls must be positive integers");const job=historicalStatus(db,jobId,now)?.job;if(!job)throw new Error("HISTORICAL_JOB_NOT_FOUND");const dry={jobId,start:job.startBoundary,cutoff:job.cutoffBoundary,successfulThrough:job.successfulThrough,nextChunk:previewHistoricalNextChunk(db,jobId),maxChunks,maxApiCalls,pacingMs:HISTORICAL_REQUEST_INTERVAL_MS,maxRetries:2,apiCalls:0,databaseMutation:false};if(!argv.includes("--execute")){console.log(JSON.stringify({dryRun:true,...dry},null,2));return;}const token=randomUUID();acquireCollectorLease(db,{token,mode:"historical",jobId,now});let cancelled=false;const signal=()=>{cancelled=true;};process.once("SIGINT",signal);process.once("SIGTERM",signal);try{const config={...loadKonepsConfig(),maxRetries:2,baseBackoffMs:1000};const result=await runHistoricalDiscovery({database:db,client:new KonepsClient({config,pacer:createRequestPacer(),rateLimitRetryDelaysMs:INITIAL_RATE_LIMIT_DELAYS_MS}),jobId,leaseToken:token,maxChunks,maxApiCalls,isCancelled:()=>cancelled,onProgress:value=>console.log(JSON.stringify({progress:value}))});console.log(JSON.stringify({dryRun:false,...result},null,2));}finally{process.removeListener("SIGINT",signal);process.removeListener("SIGTERM",signal);try{releaseCollectorLease(db,token);}catch{}}return;}
  throw new Error("command must be create, status, stop, resume, or run");
}finally{db.close();}}
main().catch(error=>{console.error(error instanceof Error?error.message:"Backfill command failed");process.exitCode=1;});
