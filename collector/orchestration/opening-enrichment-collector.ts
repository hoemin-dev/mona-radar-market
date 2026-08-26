import type{DatabaseSync}from"node:sqlite";
import type{KonepsOperation,KonepsRequestParams,KonepsResponse}from"../koneps/types.js";
import{OPENING_ENRICHMENT_OPERATIONS}from"../koneps/endpoints.js";
import{normalizeOpeningRawItem,type OpeningIdentity,OPENING_SERVICE}from"../normalization/opening-enrichment.js";
import{persistRawPage,startCollectorRun,startOperationRun}from"../storage/raw-persistence.js";

export interface OpeningClient{request(operation:KonepsOperation<any>,params:any):Promise<KonepsResponse>}
export type EnrichmentOptions={database:DatabaseSync;client:OpeningClient;requestBudget?:number;identityLimit?:number;targetDetailedProductClassNo?:string;identity?:OpeningIdentity;isCancelled?:()=>boolean;now?:()=>string};

export function seedOpeningEnrichment(db:DatabaseSync,at:string,target?:string,limit?:number):number{
 const base="SELECT DISTINCT bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no FROM award_result";
 const identities=(target?(limit!==undefined?db.prepare(`${base} WHERE target_detailed_product_class_no=? ORDER BY real_opening_local DESC,award_result_id DESC LIMIT ?`).all(target,limit):db.prepare(`${base} WHERE target_detailed_product_class_no=? ORDER BY real_opening_local DESC,award_result_id DESC`).all(target)):(limit!==undefined?db.prepare(`${base} ORDER BY real_opening_local DESC,award_result_id DESC LIMIT ?`).all(limit):db.prepare(`${base} ORDER BY real_opening_local DESC,award_result_id DESC`).all())) as {bid_ntce_no:string;bid_ntce_ord:string;bid_clsfc_no:string;rbid_no:string}[];
 const insert=db.prepare("INSERT INTO opening_enrichment_state(endpoint,bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no,status,updated_at)VALUES(?,?,?,?,?,'PENDING',?) ON CONFLICT DO NOTHING");
 let changes=0;for(const op of OPENING_ENRICHMENT_OPERATIONS)for(const i of identities)changes+=Number(insert.run(op.path,i.bid_ntce_no,i.bid_ntce_ord,i.bid_clsfc_no,i.rbid_no,at).changes);
 return changes;
}

function seedExact(db:DatabaseSync,identity:OpeningIdentity,at:string):number{const values=[identity.bidNtceNo,identity.bidNtceOrd,identity.bidClsfcNo,identity.rbidNo];if(!db.prepare("SELECT 1 FROM award_result WHERE bid_ntce_no=? AND bid_ntce_ord=? AND bid_clsfc_no=? AND rbid_no=?").get(...values))throw new Error("opening enrichment identity is not present in award_result");const insert=db.prepare("INSERT INTO opening_enrichment_state(endpoint,bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no,status,updated_at)VALUES(?,?,?,?,?,'PENDING',?) ON CONFLICT DO NOTHING");return OPENING_ENRICHMENT_OPERATIONS.reduce((n,op)=>n+Number(insert.run(op.path,...values,at).changes),0);}

export async function collectOpeningEnrichment(o:EnrichmentOptions){
 const now=o.now??(()=>new Date().toISOString()),budget=o.requestBudget??100;if(!Number.isInteger(budget)||budget<1)throw new Error("requestBudget must be a positive integer");
 if(o.identity)seedExact(o.database,o.identity,now());else seedOpeningEnrichment(o.database,now(),o.targetDetailedProductClassNo,o.identityLimit);
 o.database.prepare("UPDATE opening_enrichment_state SET status='PENDING',updated_at=? WHERE status IN ('RUNNING','FAILED')").run(now());
 const runId=startCollectorRun(o.database,{mode:"verification",startedAt:now(),appVersion:"0.1.0",parserVersion:"opening-v1"});
 const runs=new Map<string,string>();for(const op of OPENING_ENRICHMENT_OPERATIONS)runs.set(op.path,startOperationRun(o.database,{runId,service:OPENING_SERVICE,operation:op.path,queryBasis:"existing_award_result_identity",startedAt:now()}));
 let requests=0,completed=0,failed=0,cancelled=false;
 try{
  while(requests<budget&&!o.isCancelled?.()){
   const identityWhere=o.identity?" AND bid_ntce_no=? AND bid_ntce_ord=? AND bid_clsfc_no=? AND rbid_no=?":"",identityArgs=o.identity?[o.identity.bidNtceNo,o.identity.bidNtceOrd,o.identity.bidClsfcNo,o.identity.rbidNo]:[];
   const state=o.database.prepare(`SELECT endpoint,bid_ntce_no bidNtceNo,bid_ntce_ord bidNtceOrd,bid_clsfc_no bidClsfcNo,rbid_no rbidNo FROM opening_enrichment_state WHERE status='PENDING'${identityWhere} ORDER BY CASE endpoint ${OPENING_ENRICHMENT_OPERATIONS.map((x,i)=>`WHEN '${x.path}' THEN ${i}`).join(" ")} END,updated_at LIMIT 1`).get(...identityArgs) as ({endpoint:string}&OpeningIdentity)|undefined;
   if(!state)break;const op=OPENING_ENRICHMENT_OPERATIONS.find(x=>x.path===state.endpoint)!;const identity=[state.bidNtceNo,state.bidNtceOrd,state.bidClsfcNo,state.rbidNo];
   o.database.prepare("UPDATE opening_enrichment_state SET status='RUNNING',attempts=attempts+1,last_error=NULL,last_attempt_at=?,updated_at=? WHERE endpoint=? AND bid_ntce_no=? AND bid_ntce_ord=? AND bid_clsfc_no=? AND rbid_no=?").run(now(),now(),state.endpoint,...identity);
   try{let page=1,seen=0,total=0;
    do{if(requests>=budget||o.isCancelled?.()){cancelled=true;break;}const params={pageNo:page,numOfRows:100,type:"json"as const,...state};delete(params as any).endpoint;
     requests++;const response=await o.client.request(op,params);const saved=persistRawPage(o.database,{operationRunId:runs.get(op.path)!,service:OPENING_SERVICE,operation:op.path,requestedAt:response.metadata.startedAt,completedAt:response.receivedAt,durationMs:response.durationMs,httpStatus:response.status,resultCode:response.envelope.resultCode,resultMsg:response.envelope.resultMsg,pageNo:page,numOfRows:100,totalCount:response.envelope.totalCount??0,requestMetadata:params,requestUrl:response.metadata.redactedUrl,responseBytes:response.bodyBytes,contentType:response.headers["content-type"],encoding:"utf-8",parsedJson:response.parsedJson,parserVersion:"opening-v1"});
     total=response.envelope.totalCount??saved.actualItemCount;for(const id of saved.rawItemIds)normalizeOpeningRawItem(o.database,id,op.path,now());seen+=saved.actualItemCount;page++;if(saved.actualItemCount===0&&seen<total)throw new Error("OPENING_PAGINATION_STALLED");
    }while(seen<total);
    if(cancelled){o.database.prepare("UPDATE opening_enrichment_state SET status='PENDING',updated_at=? WHERE endpoint=? AND bid_ntce_no=? AND bid_ntce_ord=? AND bid_clsfc_no=? AND rbid_no=?").run(now(),state.endpoint,...identity);break;}
    o.database.prepare("UPDATE opening_enrichment_state SET status=?,completed_at=?,updated_at=? WHERE endpoint=? AND bid_ntce_no=? AND bid_ntce_ord=? AND bid_clsfc_no=? AND rbid_no=?").run(total===0?"EMPTY":"SUCCESS",now(),now(),state.endpoint,...identity);completed++;
   }catch{failed++;o.database.prepare("UPDATE opening_enrichment_state SET status='FAILED',last_error='redacted opening enrichment error',updated_at=? WHERE endpoint=? AND bid_ntce_no=? AND bid_ntce_ord=? AND bid_clsfc_no=? AND rbid_no=?").run(now(),state.endpoint,...identity);}
  }
  cancelled=cancelled||Boolean(o.isCancelled?.());const pending=o.identity?Number((o.database.prepare("SELECT count(*) n FROM opening_enrichment_state WHERE status IN ('PENDING','RUNNING','FAILED') AND bid_ntce_no=? AND bid_ntce_ord=? AND bid_clsfc_no=? AND rbid_no=?").get(o.identity.bidNtceNo,o.identity.bidNtceOrd,o.identity.bidClsfcNo,o.identity.rbidNo)as{n:number}).n):Number((o.database.prepare("SELECT count(*) n FROM opening_enrichment_state WHERE status IN ('PENDING','RUNNING','FAILED')").get()as{n:number}).n),status=cancelled?"cancelled":pending?"partial":"succeeded";
  for(const id of runs.values())o.database.prepare("UPDATE collector_operation_run SET status=?,completed_at=? WHERE operation_run_id=?").run(status==="succeeded"?"succeeded":status==="cancelled"?"cancelled":"skipped",now(),id);
  o.database.prepare("UPDATE collector_run SET status=?,completed_at=?,failed_calls=? WHERE run_id=?").run(status,now(),failed,runId);return{runId,status,requests,completed,failed,pending,budgetExhausted:requests>=budget};
 }catch(error){o.database.prepare("UPDATE collector_run SET status='failed',completed_at=?,error_summary='redacted opening enrichment error' WHERE run_id=?").run(now(),runId);throw error;}
}
