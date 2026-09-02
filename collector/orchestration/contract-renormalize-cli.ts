import { DEFAULT_MARKET_DB_PATH, openMarketDatabase } from "../storage/database.js";
import { renormalizeStoredContractDetails } from "../normalization/contract-repository.js";
const args=process.argv.slice(2),index=args.indexOf("--database"),path=index>=0?args[index+1]:DEFAULT_MARKET_DB_PATH;
const db=openMarketDatabase(path);try{const targets=(db.prepare("SELECT DISTINCT dtil_prdct_clsfc_no code FROM contract_collection_target WHERE length(dtil_prdct_clsfc_no)=8").all()as{code:string}[]).map(x=>x.code);console.log(JSON.stringify({type:"CONTRACT_RENORMALIZED_FROM_STORED_DETAIL",targets,...renormalizeStoredContractDetails(db,new Date().toISOString(),targets)}));}finally{db.close();}
