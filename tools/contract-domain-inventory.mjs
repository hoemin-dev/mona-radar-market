import { DatabaseSync } from "node:sqlite";

const path = process.argv[2];
if (!path) throw new Error("usage: node tools/contract-domain-inventory.mjs <database>");

const db = new DatabaseSync(path, { readOnly: true });
const rows = (sql) => db.prepare(sql).all();
const count = (table) => Number(db.prepare(`SELECT count(*) n FROM ${table}`).get().n);

function inventory(table, jsonColumn) {
  const total = count(table);
  const fields = rows(`
    WITH fields AS (
      SELECT j.key field,
             trim(CASE WHEN j.type IN ('array','object') THEN j.value ELSE CAST(j.value AS TEXT) END) value,
             j.type value_type
      FROM ${table} source, json_each(source.${jsonColumn}) j
    )
    SELECT field,
           count(*) occurrences,
           sum(CASE WHEN value IS NOT NULL AND value NOT IN ('', '[]', '{}', 'null') THEN 1 ELSE 0 END) non_empty,
           group_concat(DISTINCT value_type) value_types
    FROM fields GROUP BY field ORDER BY field
  `);
  const sample = db.prepare(`
    SELECT trim(CASE WHEN j.type IN ('array','object') THEN j.value ELSE CAST(j.value AS TEXT) END) value
    FROM ${table} source, json_each(source.${jsonColumn}) j
    WHERE j.key=? AND trim(CASE WHEN j.type IN ('array','object') THEN j.value ELSE CAST(j.value AS TEXT) END) NOT IN ('', '[]', '{}', 'null')
    LIMIT 1
  `);
  return fields.map((field) => ({
    ...field,
    total,
    nonEmptyPercent: total ? Math.round(Number(field.non_empty) * 10000 / total) / 100 : 0,
    example: sample.get(field.field)?.value ?? null,
  }));
}

const report = {
  schemaVersion: Number(db.prepare("PRAGMA user_version").get().user_version),
  counts: Object.fromEntries(["contract_header", "contract_item", "contract_result", "contract_catalog_cache"].map((table) => [table, count(table)])),
  columns: Object.fromEntries(["contract_header", "contract_item", "contract_result", "contract_catalog_cache"].map((table) => [table, rows(`PRAGMA table_info(${table})`).map((column) => column.name)])),
  rawFields: {
    contractHeader: inventory("contract_header", "raw_json"),
    contractItem: inventory("contract_item", "raw_json"),
  },
  corpListSamples: rows(`SELECT json_extract(raw_json,'$.corpList') value, count(*) count FROM contract_header WHERE trim(COALESCE(json_extract(raw_json,'$.corpList'),''))<>'' GROUP BY value ORDER BY count DESC LIMIT 100`),
  dminsttListSamples: rows(`SELECT json_extract(raw_json,'$.dminsttList') value, count(*) count FROM contract_header WHERE trim(COALESCE(json_extract(raw_json,'$.dminsttList'),''))<>'' GROUP BY value ORDER BY count DESC LIMIT 100`),
  totalContractAmount: rows(`SELECT CASE WHEN json_extract(raw_json,'$.totCntrctAmt') IS NULL OR trim(json_extract(raw_json,'$.totCntrctAmt'))='' THEN 'empty' WHEN CAST(replace(json_extract(raw_json,'$.totCntrctAmt'),',','') AS REAL)=0 THEN 'zero' ELSE 'nonzero' END bucket,count(*) count FROM contract_header GROUP BY bucket`),
};
console.log(JSON.stringify(report, null, 2));
db.close();
