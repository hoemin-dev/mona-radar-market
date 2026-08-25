import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { openMarketDatabase } from "../storage/database.js";
import { cachedCatalogResolution, storeCatalogResolution, upsertContractHeader, upsertContractItem } from "./contract-source-derived.js";

const at="2026-08-25T00:00:00.000Z";
function raw(db:DatabaseSync,operation:string,item:Record<string,unknown>){const json=JSON.stringify(item),hash=createHash("sha256").update(json).digest("hex");db.prepare("INSERT INTO api_raw_item(service,operation,item_sha256,canonical_json,parser_version,first_seen_at)VALUES('CntrctInfoService',?,?,?,'test',?)").run(operation,hash,json,at);return Number((db.prepare("SELECT last_insert_rowid() id").get()as{id:number}).id);}
function detail(db:DatabaseSync,header:number,item:Record<string,unknown>,resolution:Parameters<typeof upsertContractItem>[3]){return upsertContractItem(db,header,raw(db,"getCntrctInfoListThngDetail",item),resolution,at);}

test("contract items use only official catalog detailed classification and preserve 1:N identity",()=>{
 const db=openMarketDatabase(":memory:");
 const legacyRaw=raw(db,"getCntrctInfoListThngPPSSrch",{untyCntrctNo:"LEGACY",dcsnCntrctNo:"D-OLD"});
 db.prepare("INSERT INTO contract_result(target_detailed_product_class_no,decision_contract_no,source_raw_item_id,source_operation,semantic_row_hash,semantic_state_json,parse_warnings_json,first_normalized_at,last_normalized_at)VALUES('4015155300','D-OLD',?,'getCntrctInfoListThngPPSSrch',?,'{}','[]',?,?)").run(legacyRaw,"a".repeat(64),at,at);
 const headerRaw=raw(db,"getCntrctInfoListThngPPSSrch",{untyCntrctNo:"U-1",dcsnCntrctNo:"D-1",cntrctRefNo:"R-1",prdctClsfcNoNm:"전진공동펌프"}),header=upsertContractHeader(db,headerRaw,at);
 detail(db,header,{untyCntrctNo:"U-1",prdctIdntNo:"11111111",krnPrdctNm:"A",prdctQty:"1",qtyUprcAmt:"10",prdctAmt:"10"},{status:"FOUND",detailedProductClassNo:"4015155300"});
 detail(db,header,{untyCntrctNo:"U-1",prdctIdntNo:"22222222",krnPrdctNm:"B",prdctQty:"2"},{status:"FOUND",detailedProductClassNo:"4015155301"});
 detail(db,header,{untyCntrctNo:"U-1",prdctIdntNo:"33333333",krnPrdctNm:"C"},{status:"FOUND",detailedProductClassNo:"9999999999"});
 detail(db,header,{untyCntrctNo:"U-1",krnPrdctNm:"no id"},undefined);
 detail(db,header,{untyCntrctNo:"U-1",prdctIdntNo:"44444444",krnPrdctNm:"not found"},{status:"NOT_FOUND"});
 const rows=db.prepare("SELECT target_detailed_product_class_no code,resolution_status status,resolution_reason reason FROM contract_item ORDER BY contract_item_id").all()as{code:string|null;status:string;reason:string}[];
 assert.deepEqual(rows.map(x=>x.code),["4015155300","4015155301","9999999999",null,null]);
 assert.deepEqual(rows.map(x=>x.status),["RESOLVED_TARGET","RESOLVED_TARGET","RESOLVED_NON_TARGET","UNRESOLVED","UNRESOLVED"]);
 assert.equal(rows[3]!.reason,"MISSING_PRODUCT_IDENTIFICATION_NO");assert.equal(rows[4]!.reason,"CATALOG_NOT_FOUND");
 assert.equal((db.prepare("SELECT count(*) n FROM contract_item WHERE contract_header_id=?").get(header)as{n:number}).n,5);
 assert.equal((db.prepare("SELECT target_detailed_product_class_no code FROM contract_result WHERE decision_contract_no='D-OLD'").get()as{code:string}).code,"4015155300");
 assert.equal((db.prepare("SELECT raw_json FROM contract_header WHERE contract_header_id=?").get(header)as{raw_json:string}).raw_json,JSON.stringify({untyCntrctNo:"U-1",dcsnCntrctNo:"D-1",cntrctRefNo:"R-1",prdctClsfcNoNm:"전진공동펌프"}));
 db.close();
});

test("catalog cache reuses a product identification resolution including not-found",()=>{const db=openMarketDatabase(":memory:");assert.equal(cachedCatalogResolution(db,"11111111"),undefined);storeCatalogResolution(db,"11111111",{status:"FOUND",detailedProductClassNo:"4015155300"},null,at);storeCatalogResolution(db,"22222222",{status:"NOT_FOUND"},null,at);assert.deepEqual(cachedCatalogResolution(db,"11111111"),{status:"FOUND",detailedProductClassNo:"4015155300"});assert.deepEqual(cachedCatalogResolution(db,"22222222"),{status:"NOT_FOUND"});assert.equal((db.prepare("SELECT count(*) n FROM contract_catalog_cache").get()as{n:number}).n,2);db.close();});
