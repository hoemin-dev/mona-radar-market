import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { DEFAULT_MARKET_DB_PATH } from "../storage/database.js";
import { assessContractDuplicates, summarizeContractDuplicateAssessments } from "./contract-repair.js";

const args=process.argv.slice(2),index=args.indexOf("--database"),databaseArg=index>=0?args[index+1]:undefined,path=resolve(databaseArg??DEFAULT_MARKET_DB_PATH);
if(args.includes("--apply"))throw new Error("This command is intentionally dry-run only; production repair is not implemented.");
const db=new DatabaseSync(path,{readOnly:true});
try{const report=summarizeContractDuplicateAssessments(assessContractDuplicates(db));console.log(JSON.stringify({mode:"DRY_RUN",database:path,...report},null,2));}finally{db.close();}
