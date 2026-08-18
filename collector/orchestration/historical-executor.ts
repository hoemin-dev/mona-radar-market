import type { DatabaseSync } from "node:sqlite";
import type { CollectorClient } from "./collector.js";
import { runManualCollection } from "./collector.js";
import { completeHistoricalChunk, failHistoricalChunk, heartbeatCollectorLease, historicalJob, markHistoricalChunkRunning, nextHistoricalChunk, requestHistoricalStop } from "./historical-state.js";

export interface HistoricalExecutionOptions { database:DatabaseSync; client:CollectorClient; jobId:string; leaseToken:string; maxChunks:number; maxApiCalls:number; now?:()=>Date; isCancelled?:()=>boolean; onProgress?:(value:unknown)=>void; }
export async function runHistoricalDiscovery(options:HistoricalExecutionOptions){
  const now=options.now??(()=>new Date()); let chunks=0,apiCalls=0; const job=historicalJob(options.database,options.jobId);if(!job)throw new Error("HISTORICAL_JOB_NOT_FOUND");
  options.database.prepare("UPDATE historical_backfill_job SET status='running',stop_requested=0,started_at=COALESCE(started_at,?),updated_at=? WHERE job_id=?").run(now().toISOString(),now().toISOString(),job.jobId);
  while(chunks<options.maxChunks){
    if(options.isCancelled?.()){requestHistoricalStop(options.database,job.jobId,now());break;}
    if(historicalJob(options.database,job.jobId)!.stopRequested)break;
    const chunk=nextHistoricalChunk(options.database,job.jobId);if(!chunk)break;
    markHistoricalChunkRunning(options.database,chunk.chunkId,now()); heartbeatCollectorLease(options.database,options.leaseToken,now());
    const plan={mode:"initial" as const,requestedRange:{start:chunk.rangeStart,end:chunk.rangeEnd},effectiveRange:{start:chunk.rangeStart,end:chunk.rangeEnd},checkpoint:null,overlapMinutes:0,chunkMinutes:job.chunkMinutes,chunkCount:1,operations:["getBidPblancListInfoThngPPSSrch","getBidPblancListInfoThngPurchsObjPrdct","getBidPblancListInfoThngBsisAmount"]};
    const result=await runManualCollection({database:options.database,client:options.client,plan,maxApiCalls:options.maxApiCalls-apiCalls,advanceIncrementalCheckpoint:false,drainEnrichment:false,isCancelled:options.isCancelled,onProgress:options.onProgress as any,now});
    apiCalls+=Number((options.database.prepare("SELECT total_calls n FROM collector_run WHERE run_id=?").get(result.runId) as {n:number}).n);
    heartbeatCollectorLease(options.database,options.leaseToken,now());
    if(result.status!=="succeeded"){if(options.isCancelled?.())requestHistoricalStop(options.database,job.jobId,now());failHistoricalChunk(options.database,chunk.chunkId,result.status,`Historical discovery ${result.status}`,now());options.database.prepare("UPDATE historical_backfill_job SET status='paused',updated_at=?,error_summary=? WHERE job_id=?").run(now().toISOString(),`Historical discovery ${result.status}`,job.jobId);break;}
    completeHistoricalChunk(options.database,chunk.chunkId,now(),result.runId);chunks+=1;
  }
  const final=historicalJob(options.database,job.jobId)!;if(final.status!=="completed")options.database.prepare("UPDATE historical_backfill_job SET status='paused',updated_at=? WHERE job_id=?").run(now().toISOString(),job.jobId);
  return {job:historicalJob(options.database,job.jobId)!,chunksCompleted:chunks,apiCalls};
}
