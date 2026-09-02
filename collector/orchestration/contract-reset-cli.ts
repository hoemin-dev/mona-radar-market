import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_MARKET_DB_PATH } from "../storage/database.js";
import { applyContractReset, planContractReset } from "./contract-reset.js";

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;},database=resolve(value("--database")??DEFAULT_MARKET_DB_PATH),apply=args.includes("--apply");
if(!apply){const db=new DatabaseSync(database,{readOnly:true});try{console.log(JSON.stringify({...planContractReset(db),database},null,2));}finally{db.close();}}
else{const token=value("--plan-token"),backup=value("--backup");if(!token)throw new Error("--apply requires the planToken from a fresh dry-run via --plan-token");if(!backup||!existsSync(resolve(backup))||resolve(backup)===database)throw new Error("--apply requires --backup pointing to an existing separate backup file");const db=new DatabaseSync(database);try{console.log(JSON.stringify({...applyContractReset(db,token),database,backup:resolve(backup)},null,2));}finally{db.close();}}
