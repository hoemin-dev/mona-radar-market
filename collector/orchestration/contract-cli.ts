import { randomUUID } from "node:crypto";
import { openMarketDatabase, DEFAULT_MARKET_DB_PATH } from "../storage/database.js";
import { KonepsClient } from "../koneps/client.js";
import { loadKonepsConfig } from "../koneps/config.js";
import { CONTRACT_SEARCH_OPERATION } from "../koneps/endpoints.js";
import { createRequestPacer, INITIAL_RATE_LIMIT_DELAYS_MS } from "./request-pacer.js";
import { acquireCollectorLease, releaseCollectorLease } from "./historical-state.js";
import { collectContractRange } from "./contract-collector.js";
import { ContractRecoveryCancelled, contractRecoveryClient } from "./contract-recovery.js";
import { ensureContractJob, monthRange, nextContractWork, parseContractAction, type ContractTarget } from "./contract-state.js";

const value=(args:string[],name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};

async function main(){
 const args=process.argv.slice(2),db=openMarketDatabase(value(args,"--database")??DEFAULT_MARKET_DB_PATH),now=new Date(),token=randomUUID();
 try{
  const action=parseContractAction(args.includes("--action")?(value(args,"--action")??""):undefined);
  const targets=JSON.parse(value(args,"--targets")??"[]")as ContractTarget[];
  acquireCollectorLease(db,{token,mode:"manual",now});
  const id=ensureContractJob(db,targets,now,action);
  console.log(JSON.stringify({type:"CONTRACT_JOB_START",collector:"contract",action,job_id:id,start_month:nextContractWork(db,id)?.month??null,target_count:Number((db.prepare("SELECT count(*) n FROM contract_collection_target WHERE job_id=?").get(id)as{n:number}).n)}));
  let cancelled=false;const stop=()=>{cancelled=true;};process.once("SIGINT",stop);process.once("SIGTERM",stop);
  const client=new KonepsClient({config:{...loadKonepsConfig(),maxRetries:2,baseBackoffMs:1000},pacer:createRequestPacer(),rateLimitRetryDelaysMs:INITIAL_RATE_LIMIT_DELAYS_MS});
  db.prepare("UPDATE contract_collection_job SET status='running',updated_at=? WHERE job_id=?").run(now.toISOString(),id);
  let work:ReturnType<typeof nextContractWork>;
  while(!cancelled&&(work=nextContractWork(db,id))){
   try{
   const cutoff=(db.prepare("SELECT cutoff_at value FROM contract_collection_job WHERE job_id=?").get(id)as{value:string}).value;
   if(work.month>cutoff.slice(0,7)){db.prepare("UPDATE contract_collection_target SET status='completed',updated_at=? WHERE job_id=? AND dtil_prdct_clsfc_no=?").run(new Date().toISOString(),id,work.code);continue;}
   const range=monthRange(work.month,cutoff),at=new Date().toISOString();db.prepare("UPDATE contract_collection_target SET status='running',updated_at=? WHERE job_id=? AND dtil_prdct_clsfc_no=?").run(at,id,work.code);
   const monthClient=contractRecoveryClient({client,month:work.month,isCancelled:()=>cancelled});
   const probeResponse=await monthClient.request(CONTRACT_SEARCH_OPERATION,{pageNo:1,numOfRows:1,type:"json",inqryDiv:"1",inqryBgnDate:range.start.slice(0,10).replace(/-/gu,""),inqryEndDate:range.end.slice(0,10).replace(/-/gu,""),prdctClsfcNoNm:work.name}),total=probeResponse.envelope.totalCount??0;
   db.prepare("INSERT INTO contract_month_probe(job_id,dtil_prdct_clsfc_no,month,range_start,range_end,total_count,status,probed_at)VALUES(?,?,?,?,?,?,'probed',?) ON CONFLICT(job_id,dtil_prdct_clsfc_no,month)DO UPDATE SET total_count=excluded.total_count,status='probed',probed_at=excluded.probed_at").run(id,work.code,work.month,range.start,range.end,total,at);
   console.log(JSON.stringify({type:"CONTRACT_MONTH_PROBE",month:work.month,probeTotal:total}));let runId:string|null=null;
   if(total>0){db.prepare("UPDATE contract_month_probe SET status='collecting' WHERE job_id=? AND dtil_prdct_clsfc_no=? AND month=?").run(id,work.code,work.month);const result=await collectContractRange({database:db,client:monthClient,discoveryName:work.name,targetCodes:[work.code],range,isCancelled:()=>cancelled,onProgress:p=>console.log(JSON.stringify({progress:{collector:"contract",month:work!.month,...p}}))});runId=result.runId;if(result.status!=="succeeded")break;}
   const done=new Date().toISOString();db.prepare("UPDATE contract_month_probe SET status='collected',completed_at=?,last_run_id=COALESCE(?,last_run_id) WHERE job_id=? AND dtil_prdct_clsfc_no=? AND month=?").run(done,runId,id,work.code,work.month);db.prepare("UPDATE contract_collection_target SET status='paused',successful_through_month=?,updated_at=? WHERE job_id=? AND dtil_prdct_clsfc_no=?").run(work.month,done,id,work.code);
   }catch(error){if(error instanceof ContractRecoveryCancelled)break;throw error;}
  }
  const remaining=Number((db.prepare("SELECT count(*) n FROM contract_collection_target WHERE job_id=? AND status!='completed'").get(id)as{n:number}).n);db.prepare("UPDATE contract_collection_job SET status=?,updated_at=?,completed_at=? WHERE job_id=?").run(remaining?"paused":"completed",new Date().toISOString(),remaining?null:new Date().toISOString(),id);
 }finally{try{releaseCollectorLease(db,token);}catch{}db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"contract collector failed");process.exitCode=1;});
