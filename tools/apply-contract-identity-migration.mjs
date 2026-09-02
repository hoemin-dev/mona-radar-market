import { backup, DatabaseSync } from "node:sqlite";
import { openMarketDatabase } from "../dist-collector/storage/database.js";

const path = process.argv[2];
if (!path) throw new Error("usage: node tools/apply-contract-identity-migration.mjs <database>");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backupPath = `${path}.pre-v22-${stamp}.backup`;
const metrics = db => ({
  version: db.prepare("PRAGMA user_version").get().user_version,
  contractResults: db.prepare("SELECT count(*) n FROM contract_result").get().n,
  tenDigitTargets: db.prepare("SELECT count(*) n FROM contract_result WHERE length(target_detailed_product_class_no)=10").get().n,
  target40151553: db.prepare("SELECT count(*) n FROM contract_result WHERE target_detailed_product_class_no='40151553'").get().n,
  duplicateDecisionGroups: db.prepare("SELECT count(*) n FROM (SELECT decision_contract_no FROM contract_result GROUP BY decision_contract_no HAVING count(*)>1)").get().n,
  itemTenDigitTargets: db.prepare("SELECT count(*) n FROM contract_item WHERE length(target_detailed_product_class_no)=10").get().n,
  foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all(),
});

const source = new DatabaseSync(path);
source.exec("PRAGMA busy_timeout=5000");
const before = metrics(source);
const keepers = source.prepare("SELECT decision_contract_no,MIN(contract_result_id) keep_id,group_concat(contract_result_id) ids FROM contract_result GROUP BY decision_contract_no HAVING count(*)>1 ORDER BY decision_contract_no").all();
await backup(source, backupPath);
const backupDb = new DatabaseSync(backupPath, {readOnly:true});
const backupCheck = backupDb.prepare("PRAGMA integrity_check").get().integrity_check;
backupDb.close(); source.close();
if (backupCheck !== "ok") throw new Error(`backup integrity check failed: ${backupCheck}`);

const migrated = openMarketDatabase(path);
const after = metrics(migrated);
const preserved = keepers.map(({decision_contract_no,keep_id,ids})=>({
  decisionContractNo: decision_contract_no, beforeIds: ids, keptId: keep_id,
  preserved: migrated.prepare("SELECT contract_result_id FROM contract_result WHERE decision_contract_no=?").get(decision_contract_no)?.contract_result_id === keep_id,
}));
const integrityCheck = migrated.prepare("PRAGMA integrity_check").get().integrity_check;
migrated.close();
console.log(JSON.stringify({path,backupPath,backupIntegrityCheck:backupCheck,before,after,integrityCheck,preservedIds:preserved},null,2));
