import assert from "node:assert/strict";
import test from "node:test";
import { KonepsError } from "../koneps/errors.js";
import { CONTRACT_SEARCH_OPERATION } from "../koneps/endpoints.js";
import type { KonepsResponse } from "../koneps/types.js";
import type { ContractClient } from "./contract-collector.js";
import { ContractRecoveryCancelled, contractRecoveryClient } from "./contract-recovery.js";

const params={pageNo:1,numOfRows:1,type:"json" as const,inqryDiv:"1" as const,inqryBgnDate:"20220301",inqryEndDate:"20220331",prdctClsfcNoNm:"pump"};
const response={envelope:{resultCode:"00",resultMsg:"OK",totalCount:1}} as KonepsResponse;
const http=(status:number)=>new KonepsError("http",`HTTP ${status}`,{service:"CntrctInfoService",operation:"getCntrctInfoListThng",redactedUrl:"redacted",pageNo:1,numOfRows:1,httpStatus:status,startedAt:"2022-03-01T00:00:00.000Z",finishedAt:"2022-03-01T00:00:01.000Z",durationMs:1000,attemptCount:3,retryCount:2});

test("a month advances only after a transient base cycle recovers",async()=>{
 let calls=0,cooldowns=0,checkpoint="2022-02";
 const client={request:async()=>{calls++;if(calls===1)throw new KonepsError("timeout","timed out");return response;}}as ContractClient;
 const recovered=contractRecoveryClient({client,month:"2022-03",isCancelled:()=>false,cooldown:async ms=>{assert.equal(ms,30_000);cooldowns++;},log:()=>{}});
 await recovered.request(CONTRACT_SEARCH_OPERATION,params);checkpoint="2022-03";
 assert.deepEqual({calls,cooldowns,checkpoint},{calls:2,cooldowns:1,checkpoint:"2022-03"});
});

test("three exhausted recovery cycles preserve the month checkpoint",async()=>{
 let calls=0,checkpoint="2022-02";const events:Readonly<Record<string,unknown>>[]=[];
 const client={request:async()=>{calls++;throw new KonepsError("timeout","timed out");}}as ContractClient;
 const recovered=contractRecoveryClient({client,month:"2022-03",isCancelled:()=>false,cooldown:async()=>{},log:event=>events.push(event)});
 await assert.rejects(()=>recovered.request(CONTRACT_SEARCH_OPERATION,params),error=>error instanceof KonepsError&&error.category==="timeout");
 assert.equal(calls,4);assert.equal(checkpoint,"2022-02");assert.deepEqual(events.at(-1),{type:"CONTRACT_MONTH_RECOVERY_EXHAUSTED",month:"2022-03",cycles:3});
});

test("authentication and deterministic API/HTTP errors bypass recovery",async()=>{
 for(const error of[new KonepsError("api","bad service key"),http(401),http(400),new KonepsError("parse","invalid JSON"),new KonepsError("structure","invalid envelope")]){
  let calls=0,cooldowns=0;const client={request:async()=>{calls++;throw error;}}as ContractClient;
  const recovered=contractRecoveryClient({client,month:"2022-03",isCancelled:()=>false,cooldown:async()=>{cooldowns++;},log:()=>{}});
  await assert.rejects(()=>recovered.request(CONTRACT_SEARCH_OPERATION,params),candidate=>candidate===error);
  assert.deepEqual({calls,cooldowns},{calls:1,cooldowns:0});
 }
});

test("stop during cooldown exits without another request",async()=>{
 let calls=0,cancelled=false;const client={request:async()=>{calls++;throw new KonepsError("network","reset");}}as ContractClient;
 const recovered=contractRecoveryClient({client,month:"2022-03",isCancelled:()=>cancelled,cooldown:async()=>{cancelled=true;},log:()=>{}});
 await assert.rejects(()=>recovered.request(CONTRACT_SEARCH_OPERATION,params),ContractRecoveryCancelled);
 assert.equal(calls,1);
});

test("a normal request has no recovery cooldown",async()=>{
 let calls=0,cooldowns=0;const client={request:async()=>{calls++;return response;}}as ContractClient;
 const recovered=contractRecoveryClient({client,month:"2022-03",isCancelled:()=>false,cooldown:async()=>{cooldowns++;},log:()=>{}});
 assert.equal(await recovered.request(CONTRACT_SEARCH_OPERATION,params),response);
 assert.deepEqual({calls,cooldowns},{calls:1,cooldowns:0});
});
