import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { openMarketDatabase, DEFAULT_MARKET_DB_PATH } from "../storage/database.js";
import { KonepsClient } from "../koneps/client.js";
import { loadKonepsConfig } from "../koneps/config.js";
import { LIFECYCLE_INTEGRATED_OPERATION } from "../koneps/endpoints.js";
import { lifecyclePayload, saveLifecycle, LIFECYCLE_OPERATION, LIFECYCLE_SERVICE } from "../normalization/lifecycle.js";
import { persistRawPage, startCollectorRun, startOperationRun } from "../storage/raw-persistence.js";
import { acquireCollectorLease, releaseCollectorLease } from "./historical-state.js";
import { createRequestPacer, INITIAL_RATE_LIMIT_DELAYS_MS } from "./request-pacer.js";

const value=(args:string[],name:string)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const pauseFile=process.env.MARKET_COLLECTOR_PAUSE_FILE;
const now=()=>new Date().toISOString();
type Work={id:number;no:string;ord:string};

function statistics(db:ReturnType<typeof openMarketDatabase>){
  const one=(sql:string)=>Number((db.prepare(sql).get()as{n:number}).n);
  return {
    targetNotices:one("SELECT count(*) n FROM lifecycle_collection_state"),
    success:one("SELECT count(*) n FROM lifecycle_collection_state WHERE status='SUCCESS'"),
    noData:one("SELECT count(*) n FROM lifecycle_collection_state WHERE status='NO_DATA'"),
    failed:one("SELECT count(*) n FROM lifecycle_collection_state WHERE status='FAILED'"),
    matchedAwards:one("SELECT count(*) n FROM bid_award_link WHERE relationship_source='official_integrated_api' AND match_status='official_matched'"),
    matchedContracts:one("SELECT count(*) n FROM bid_contract_link WHERE relationship_source='official_integrated_api' AND match_status='official_matched'"),
    unmatched:one("SELECT (SELECT count(*) FROM bid_award_link WHERE match_status='official_unmatched' AND json_extract(evidence_json,'$.unmatchedReason') NOT LIKE 'multiple_%')+(SELECT count(*) FROM bid_contract_link WHERE match_status='official_unmatched' AND json_extract(evidence_json,'$.unmatchedReason') NOT LIKE 'multiple_%') n"),
    ambiguous:one("SELECT (SELECT count(*) FROM bid_award_link WHERE json_extract(evidence_json,'$.unmatchedReason') LIKE 'multiple_%')+(SELECT count(*) FROM bid_contract_link WHERE json_extract(evidence_json,'$.unmatchedReason') LIKE 'multiple_%') n"),
    multipleAwardNotices:one("SELECT count(*) n FROM (SELECT lifecycle_record_id FROM lifecycle_award GROUP BY lifecycle_record_id HAVING count(*)>1)"),
    multipleContractNotices:one("SELECT count(*) n FROM (SELECT lifecycle_record_id FROM lifecycle_contract GROUP BY lifecycle_record_id HAVING count(*)>1)"),
  };
}

async function main(){
  const args=process.argv.slice(2),db=openMarketDatabase(value(args,"--database")??DEFAULT_MARKET_DB_PATH),token=randomUUID();
  let runId:string|undefined,operationRunId:string|undefined,cancelled=false,failures=0,processed=0;
  const cancel=()=>{cancelled=true;};process.once("SIGINT",cancel);process.once("SIGTERM",cancel);
  try{
    acquireCollectorLease(db,{token,mode:"manual",now:new Date()});
    db.prepare("UPDATE lifecycle_collection_state SET status='FAILED',last_error_category='interrupted',last_error_summary='previous collection interrupted',updated_at=? WHERE status='RUNNING'").run(now());
    db.prepare("INSERT INTO lifecycle_collection_state(bid_notice_id,status,updated_at) SELECT bid_notice_id,'PENDING',? FROM bid_notice WHERE true ON CONFLICT(bid_notice_id) DO NOTHING").run(now());
    runId=startCollectorRun(db,{mode:"incremental",startedAt:now(),appVersion:"0.1.0",parserVersion:"lifecycle-v2"});
    operationRunId=startOperationRun(db,{runId,service:LIFECYCLE_SERVICE,operation:LIFECYCLE_OPERATION,queryBasis:"existing_goods_bid_notice_missing_or_failed",startedAt:now()});
    const client=new KonepsClient({config:{...loadKonepsConfig(),maxRetries:2,baseBackoffMs:1000},pacer:createRequestPacer(),rateLimitRetryDelaysMs:INITIAL_RATE_LIMIT_DELAYS_MS,onRateLimitRetry:event=>console.log(JSON.stringify({type:"RATE_LIMIT_RETRY",collector:"lifecycle",attempt:event.attempt,waitSeconds:event.waitSeconds,operation:event.operation}))});
    const work=db.prepare(`SELECT b.bid_notice_id id,b.bid_ntce_no no,b.bid_ntce_ord ord
      FROM lifecycle_collection_state s JOIN bid_notice b ON b.bid_notice_id=s.bid_notice_id
      WHERE s.status IN ('PENDING','FAILED')
      ORDER BY CASE WHEN s.attempts=0 THEN 0 WHEN s.status='FAILED' THEN 1
        WHEN EXISTS(SELECT 1 FROM award_result a WHERE a.bid_notice_id=b.bid_notice_id)
          AND NOT EXISTS(SELECT 1 FROM lifecycle_record l WHERE l.bid_notice_id=b.bid_notice_id) THEN 2 ELSE 3 END,
        b.bid_notice_id`).all()as Work[];
    let success=0,noData=0;
    console.log(JSON.stringify({type:"LIFECYCLE_START",targetNotices:work.length,request:{operation:LIFECYCLE_OPERATION,inqryDiv:"1"}}));
    for(const item of work){
      if(cancelled||(pauseFile&&existsSync(pauseFile)))break;
      db.prepare("UPDATE lifecycle_collection_state SET status='RUNNING',attempts=attempts+1,last_attempt_at=?,updated_at=? WHERE bid_notice_id=?").run(now(),now(),item.id);
      try{
        const params={pageNo:1,numOfRows:100,type:"json" as const,inqryDiv:"1" as const,bidNtceNo:item.no,bidNtceOrd:item.ord||undefined};
        const response=await client.request(LIFECYCLE_INTEGRATED_OPERATION,params);
        const saved=persistRawPage(db,{operationRunId,service:LIFECYCLE_SERVICE,operation:LIFECYCLE_OPERATION,requestedAt:response.metadata.startedAt,completedAt:response.receivedAt,durationMs:response.durationMs,httpStatus:response.status,resultCode:response.envelope.resultCode,resultMsg:response.envelope.resultMsg,pageNo:1,numOfRows:100,totalCount:response.envelope.totalCount??0,requestMetadata:params,requestUrl:response.metadata.redactedUrl,responseBytes:response.bodyBytes,contentType:response.headers["content-type"],parsedJson:response.parsedJson,parserVersion:"lifecycle-v2"});
        const payload=lifecyclePayload(response.parsedJson),completedAt=now();
        let result={awards:0,contracts:0,matchedAwards:0,matchedContracts:0,unmatched:0,ambiguous:0};
        if(payload){
          const rawItemId=saved.rawItemIds[0];if(rawItemId===undefined)throw new Error("LIFECYCLE_RAW_ITEM_MISSING");
          result=saveLifecycle(db,{bidNoticeId:item.id,rawItemId,payload,collectedAt:completedAt});
          db.prepare("UPDATE lifecycle_collection_state SET status='SUCCESS',collected_at=?,last_call_id=?,last_error_category=NULL,last_error_summary=NULL,updated_at=? WHERE bid_notice_id=?").run(completedAt,saved.callId,completedAt,item.id);success++;
        }else{
          db.prepare("UPDATE lifecycle_collection_state SET status='NO_DATA',collected_at=?,last_call_id=?,last_error_category=NULL,last_error_summary=NULL,updated_at=? WHERE bid_notice_id=?").run(completedAt,saved.callId,completedAt,item.id);noData++;
        }
        processed++;
        console.log(JSON.stringify({progress:{collector:"lifecycle",processed,total:work.length,success,noData,failed:failures,currentBidNtceNo:item.no,progressPercent:work.length?Math.round(processed/work.length*100):100,...result}}));
      }catch{
        failures++;processed++;
        db.prepare("UPDATE lifecycle_collection_state SET status='FAILED',last_error_category='api_gateway_or_parse',last_error_summary='redacted lifecycle collection error',updated_at=? WHERE bid_notice_id=?").run(now(),item.id);
        console.log(JSON.stringify({progress:{collector:"lifecycle",processed,total:work.length,success,noData,failed:failures,currentBidNtceNo:item.no,progressPercent:work.length?Math.round(processed/work.length*100):100},type:"LIFECYCLE_ITEM_FAILED"}));
      }
    }
    const paused=cancelled||!!(pauseFile&&existsSync(pauseFile)),operationStatus=paused?"cancelled":failures?"failed":"succeeded",runStatus=paused?"cancelled":failures?"partial":"succeeded";
    db.prepare("UPDATE collector_operation_run SET status=?,completed_at=?,error_summary=? WHERE operation_run_id=?").run(operationStatus,now(),failures?`${failures} lifecycle notices failed`:null,operationRunId);
    db.prepare("UPDATE collector_run SET status=?,completed_at=?,error_summary=? WHERE run_id=?").run(runStatus,now(),failures?`${failures} lifecycle notices failed`:null,runId);
    console.log(JSON.stringify({type:paused?"LIFECYCLE_PAUSED":"LIFECYCLE_COMPLETE",processed,runTargetNotices:work.length,...statistics(db)}));
  }finally{
    try{releaseCollectorLease(db,token);}catch{}
    db.close();
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Lifecycle collector failed");process.exitCode=1;});
