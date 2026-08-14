import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { DEFAULT_MARKET_DB_PATH } from "../storage/database.js";

function value(argv:readonly string[],name:string):string|undefined{const i=argv.indexOf(name);return i<0?undefined:argv[i+1];}
function main():void{
  const path=value(process.argv.slice(2),"--database")??DEFAULT_MARKET_DB_PATH;
  if(!existsSync(path)){console.log(JSON.stringify({databasePath:path,exists:false},null,2));return;}
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    const latest=db.prepare(`SELECT run_id,mode,requested_range_start,requested_range_end,effective_range_start,effective_range_end,status,
      total_calls,total_items,failed_calls,retry_count,inserted_count,unchanged_count,updated_count,deferred_count,normalization_error_count,
      started_at,completed_at,error_summary FROM collector_run ORDER BY started_at DESC,rowid DESC LIMIT 1`).get() as Record<string,unknown>|undefined;
    const runId=latest?.run_id;
    const operations=runId?db.prepare(`SELECT operation,status,page_count,call_count,item_count,failed_call_count,retry_count,
      inserted_count,unchanged_count,updated_count,deferred_count,normalization_error_count,error_summary
      FROM collector_operation_run WHERE run_id=? ORDER BY operation`).all(runId as string):[];
    const checkpoints=db.prepare("SELECT service,operation,query_basis,successful_through,last_run_id FROM collector_checkpoint ORDER BY checkpoint_id").all();
    const work=runId?db.prepare("SELECT operation,status,count(*) AS count,sum(attempts) AS attempts FROM collector_work_item WHERE created_run_id=? OR last_attempt_run_id=? GROUP BY operation,status ORDER BY operation,status").all(runId as string,runId as string):[];
    const counts=Object.fromEntries(["api_call","api_response_blob","api_raw_item","raw_item_observation","bid_notice","bid_notice_revision","bid_item","bid_item_revision","bid_basis_amount","bid_basis_amount_revision"].map(table=>[table,(db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {count:number}).count]));
    const integrity={
      foreignKeyViolations:db.prepare("PRAGMA foreign_key_check").all().length,
      itemParentMissing:(db.prepare("SELECT count(*) count FROM bid_item i LEFT JOIN bid_notice n ON n.bid_notice_id=i.bid_notice_id WHERE n.bid_notice_id IS NULL").get() as {count:number}).count,
      basisParentMissing:(db.prepare("SELECT count(*) count FROM bid_basis_amount b LEFT JOIN bid_notice n ON n.bid_notice_id=b.bid_notice_id WHERE n.bid_notice_id IS NULL").get() as {count:number}).count,
      normalizedRawMissing:(db.prepare(`SELECT (SELECT count(*) FROM bid_notice n LEFT JOIN api_raw_item r ON r.raw_item_id=n.source_raw_item_id WHERE r.raw_item_id IS NULL)+
        (SELECT count(*) FROM bid_item i LEFT JOIN api_raw_item r ON r.raw_item_id=i.source_raw_item_id WHERE r.raw_item_id IS NULL)+
        (SELECT count(*) FROM bid_basis_amount b LEFT JOIN api_raw_item r ON r.raw_item_id=b.source_raw_item_id WHERE r.raw_item_id IS NULL) count`).get() as {count:number}).count,
      observationCallOrBlobMissing:(db.prepare(`SELECT count(*) count FROM raw_item_observation o LEFT JOIN api_call c ON c.call_id=o.call_id LEFT JOIN api_response_blob b ON b.response_blob_id=c.response_blob_id WHERE c.call_id IS NULL OR b.response_blob_id IS NULL`).get() as {count:number}).count,
      unsafeStoredUrl:(db.prepare("SELECT count(*) count FROM api_call WHERE instr(lower(redacted_url),'servicekey=')>0 AND instr(redacted_url,'[REDACTED]')=0").get() as {count:number}).count,
      serviceKeyInMetadata:(db.prepare("SELECT count(*) count FROM api_call WHERE instr(lower(request_metadata_json),'servicekey')>0").get() as {count:number}).count,
    };
    console.log(JSON.stringify({databasePath:path,exists:true,latestRun:latest??null,operations,checkpoints,work,counts,integrity},null,2));
  }finally{db.close();}
}
main();
