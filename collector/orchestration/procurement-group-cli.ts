import { openMarketDatabase } from "../storage/database.js";
import { rebuildProcurementGroups } from "./procurement-group-builder.js";
const db=openMarketDatabase();try{console.log(JSON.stringify(rebuildProcurementGroups(db)));}finally{db.close();}
