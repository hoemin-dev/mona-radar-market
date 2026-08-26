import{openMarketDatabase,DEFAULT_MARKET_DB_PATH}from"../storage/database.js";
import{loadKonepsConfig}from"../koneps/config.js";
import{AwardKonepsClient}from"./award-koneps-client.js";
import{createRequestPacer,INITIAL_RATE_LIMIT_DELAYS_MS}from"./request-pacer.js";
import{collectOpeningEnrichment}from"./opening-enrichment-collector.js";
function value(a:string[],n:string){const i=a.indexOf(n);return i<0?undefined:a[i+1];}
async function main(){const a=process.argv.slice(2),db=openMarketDatabase(value(a,"--database")??DEFAULT_MARKET_DB_PATH);let cancelled=false;process.once("SIGINT",()=>{cancelled=true;});process.once("SIGTERM",()=>{cancelled=true;});try{const client=new AwardKonepsClient({config:{...loadKonepsConfig(),maxRetries:2,baseBackoffMs:1000},pacer:createRequestPacer(),rateLimitRetryDelaysMs:INITIAL_RATE_LIMIT_DELAYS_MS}),bidNtceNo=value(a,"--bid-ntce-no"),identity=bidNtceNo?{bidNtceNo,bidNtceOrd:value(a,"--bid-ntce-ord")??"000",bidClsfcNo:value(a,"--bid-clsfc-no")??"1",rbidNo:value(a,"--rbid-no")??"000"}:undefined;const result=await collectOpeningEnrichment({database:db,client,requestBudget:Number(value(a,"--request-budget")??"100"),identityLimit:value(a,"--identity-limit")?Number(value(a,"--identity-limit")):undefined,targetDetailedProductClassNo:value(a,"--target"),identity,isCancelled:()=>cancelled});console.log(JSON.stringify(result));}finally{db.close();}}
main().catch(e=>{console.error(e instanceof Error?e.message:"Opening enrichment failed");process.exitCode=1;});
