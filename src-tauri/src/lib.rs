use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
mod credentials {
    use serde::{Deserialize, Serialize};
    use std::{ffi::c_void, ptr};
    use windows_sys::Win32::{
        Foundation::{ERROR_NOT_FOUND, FILETIME},
        Security::Credentials::{
            CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };
    pub const TARGET: &str = "MonaRadar/Market/KONEPS";
    #[derive(Serialize, Deserialize)]
    pub struct StoredCredential {
        pub service_key: String,
        pub mode: String,
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    pub fn write(service_key: &str, mode: &str) -> Result<(), String> {
        let target = wide(TARGET);
        let username = wide("KONEPS_SERVICE_KEY");
        let mut blob = serde_json::to_vec(&StoredCredential {
            service_key: service_key.to_owned(),
            mode: mode.to_owned(),
        })
        .map_err(|_| "Credential serialization failed".to_string())?;
        let credential = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_ptr() as *mut _,
            Comment: ptr::null_mut(),
            LastWritten: FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            },
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: ptr::null_mut(),
            TargetAlias: ptr::null_mut(),
            UserName: username.as_ptr() as *mut _,
        };
        let ok = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        if ok == 0 {
            Err("Windows Credential Manager에 API 키를 저장하지 못했습니다.".into())
        } else {
            Ok(())
        }
    }
    pub fn read() -> Result<Option<StoredCredential>, String> {
        let target = wide(TARGET);
        let mut raw: *mut CREDENTIALW = ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
            return if std::io::Error::last_os_error().raw_os_error() == Some(ERROR_NOT_FOUND as i32)
            {
                Ok(None)
            } else {
                Err("Windows Credential Manager에서 API 키를 읽지 못했습니다.".into())
            };
        };
        let result = (|| {
            let credential = unsafe { &*raw };
            let bytes = unsafe {
                std::slice::from_raw_parts(
                    credential.CredentialBlob as *const u8,
                    credential.CredentialBlobSize as usize,
                )
            };
            serde_json::from_slice::<StoredCredential>(bytes)
                .map(Some)
                .map_err(|_| "저장된 API 키 형식이 올바르지 않습니다.".to_string())
        })();
        unsafe { CredFree(raw as *const c_void) };
        result
    }
}
#[cfg(not(windows))]
mod credentials {
    pub const TARGET: &str = "MonaRadar/Market/KONEPS";
    pub struct StoredCredential {
        pub service_key: String,
        pub mode: String,
    }
    pub fn write(_: &str, _: &str) -> Result<(), String> {
        Err("Windows Credential Manager는 Windows에서만 사용할 수 있습니다.".into())
    }
    pub fn read() -> Result<Option<StoredCredential>, String> {
        Ok(None)
    }
}

struct CollectorState(Mutex<Option<Child>>);

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("MonaRadar")
        .join("Market");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("mona-radar-market.sqlite3"))
}
fn connection(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    if !path.exists() {
        return Err(
            "아직 수집된 로컬 데이터가 없습니다. Collector에서 초기 수집을 시작하세요.".into(),
        );
    }
    let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(db)
}
fn value_or_empty(row: &rusqlite::Row<'_>, i: usize) -> String {
    row.get::<_, Option<String>>(i)
        .ok()
        .flatten()
        .unwrap_or_default()
}

#[tauri::command]
fn dashboard_summary(app: AppHandle) -> Result<Value, String> {
    let db = connection(&app)?;
    Ok(json!({
    "notices":db.query_row("SELECT count(*) FROM bid_notice",[],|r|r.get::<_,i64>(0)).unwrap_or(0),
    "items":db.query_row("SELECT count(*) FROM bid_item",[],|r|r.get::<_,i64>(0)).unwrap_or(0),
    "basisAmounts":db.query_row("SELECT count(*) FROM bid_basis_amount",[],|r|r.get::<_,i64>(0)).unwrap_or(0),
    "latestNotice":db.query_row("SELECT max(notice_posted_local) FROM bid_notice",[],|r|r.get::<_,Option<String>>(0)).unwrap_or(None),
    "checkpoint":db.query_row("SELECT checkpoint_at FROM collector_checkpoint ORDER BY checkpoint_at DESC LIMIT 1",[],|r|r.get::<_,Option<String>>(0)).unwrap_or(None),
    "recentRuns": db.prepare("SELECT status,started_at,completed_at,inserted_count,updated_count,unchanged_count,error_summary FROM collector_run ORDER BY started_at DESC LIMIT 8").map_err(|e|e.to_string())?.query_map([],|r|Ok(json!({"status":value_or_empty(r,0),"startedAt":value_or_empty(r,1),"completedAt":value_or_empty(r,2),"inserted":r.get::<_,i64>(3).unwrap_or(0),"updated":r.get::<_,i64>(4).unwrap_or(0),"unchanged":r.get::<_,i64>(5).unwrap_or(0),"error":value_or_empty(r,6)}))).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>()
    }))
}

#[tauri::command]
fn search_awards(
    app: AppHandle,
    query: Option<String>,
    category: Option<String>,
    product_name: Option<String>,
    product_class_no: Option<String>,
    opening_from: Option<String>,
    opening_to: Option<String>,
    amount_min: Option<i64>,
    amount_max: Option<i64>,
    rate_min: Option<f64>,
    rate_max: Option<f64>,
    winner: Option<String>,
    demand_institution: Option<String>,
    limit: Option<i64>,
) -> Result<Value, String> {
    let db = connection(&app)?;
    let limit = limit.unwrap_or(300).clamp(1, 500);
    let q = query.unwrap_or_default().trim().to_owned();
    let category = category.unwrap_or_else(|| "all".into());
    if !matches!(category.as_str(), "all" | "product" | "part") {
        return Err("지원하지 않는 제품 구분입니다.".into());
    }
    let product_name = product_name.unwrap_or_default().trim().to_owned();
    let product_class_no = product_class_no.unwrap_or_default().trim().to_owned();
    let opening_from = opening_from.unwrap_or_default();
    let opening_to = opening_to.unwrap_or_default();
    let winner = winner.unwrap_or_default().trim().to_owned();
    let demand = demand_institution.unwrap_or_default().trim().to_owned();
    let pattern = format!("%{}%", q);
    let winner_pattern = format!("%{}%", winner);
    let demand_pattern = format!("%{}%", demand);
    let product_name_pattern = format!("%{}%", product_name);
    let product_class_pattern = format!("%{}%", product_class_no);
    let sql = "SELECT DISTINCT a.award_result_id,a.bid_ntce_no,a.bid_ntce_ord,a.bid_ntce_name,
        a.target_detailed_product_class_no,a.winner_name,a.winner_business_no,
        a.winner_ceo_name,a.winner_address,a.winner_tel_no,a.successful_bid_amount,
        a.successful_bid_rate,a.demand_institution_name,a.demand_institution_code,
        a.real_opening_local,a.participant_count,
        (SELECT t.target_name FROM award_collection_target t
         WHERE t.dtil_prdct_clsfc_no=a.target_detailed_product_class_no
         ORDER BY t.updated_at DESC LIMIT 1) AS target_name,
        c.category AS product_category,l.source AS product_category_source
      FROM award_result a
      LEFT JOIN award_catalog_item_link l ON l.award_result_id=a.award_result_id
      LEFT JOIN catalog_item_category c ON c.prdct_idnt_no=l.prdct_idnt_no
      WHERE (?1='' OR a.bid_ntce_name LIKE ?2 OR a.winner_name LIKE ?2
        OR a.demand_institution_name LIKE ?2 OR a.target_detailed_product_class_no LIKE ?2
        OR a.bid_ntce_no LIKE ?2)
        AND (?3='' OR substr(a.real_opening_local,1,10)>=?3)
        AND (?4='' OR substr(a.real_opening_local,1,10)<=?4)
        AND (?5 IS NULL OR a.successful_bid_amount>=?5)
        AND (?6 IS NULL OR a.successful_bid_amount<=?6)
        AND (?7 IS NULL OR CAST(a.successful_bid_rate AS REAL)>=?7)
        AND (?8 IS NULL OR CAST(a.successful_bid_rate AS REAL)<=?8)
        AND (?9='' OR a.winner_name LIKE ?10)
        AND (?11='' OR a.demand_institution_name LIKE ?12)
        AND (?13='all' OR c.category=?13)
        AND (?14='' OR (SELECT t.target_name FROM award_collection_target t
          WHERE t.dtil_prdct_clsfc_no=a.target_detailed_product_class_no
          ORDER BY t.updated_at DESC LIMIT 1) LIKE ?15)
        AND (?16='' OR a.target_detailed_product_class_no LIKE ?17)
      ORDER BY a.real_opening_local DESC,a.award_result_id DESC LIMIT ?18";
    let rows=db.prepare(sql).map_err(|e|e.to_string())?.query_map(
        params![q,pattern,opening_from,opening_to,amount_min,amount_max,rate_min,rate_max,winner,winner_pattern,demand,demand_pattern,category,product_name,product_name_pattern,product_class_no,product_class_pattern,limit],
        |r|Ok(json!({"awardResultId":r.get::<_,i64>(0)?,"bidNo":value_or_empty(r,1),"bidOrd":value_or_empty(r,2),"name":value_or_empty(r,3),"productClassNo":value_or_empty(r,4),"winnerName":value_or_empty(r,5),"winnerBusinessNo":value_or_empty(r,6),"winnerCeoName":value_or_empty(r,7),"winnerAddress":value_or_empty(r,8),"winnerTelNo":value_or_empty(r,9),"successfulBidAmount":r.get::<_,Option<i64>>(10)?,"successfulBidRate":value_or_empty(r,11),"demandInstitution":value_or_empty(r,12),"demandInstitutionCode":value_or_empty(r,13),"realOpeningLocal":value_or_empty(r,14),"participantCount":r.get::<_,Option<i64>>(15)?,"productClassName":value_or_empty(r,16),"productCategory":value_or_empty(r,17),"productCategorySource":value_or_empty(r,18)}))
    ).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(json!({"rows":rows}))
}

#[tauri::command]
fn search_procurements(app: AppHandle, mode: String, query: Option<String>, category: Option<String>, limit: Option<i64>) -> Result<Value, String> {
    let db=connection(&app)?;let q=query.unwrap_or_default().trim().to_owned();let pattern=format!("%{}%",q);let category=category.unwrap_or_else(||"all".into());let limit=limit.unwrap_or(300).clamp(1,500);
    if !matches!(mode.as_str(),"integrated"|"bid"|"contract")||!matches!(category.as_str(),"all"|"product"|"part"){return Err("지원하지 않는 검색 구분입니다.".into());}
    let sql=match mode.as_str(){
      "integrated"=>"SELECT procurement_group_id,representative_date,representative_title,demand_institution_name,detailed_product_class_no,detailed_product_class_name,item_category,representative_winner_name,representative_award_amount,representative_award_rate,representative_contract_name,representative_contract_amount,bid_count,award_count,contract_count,match_status FROM procurement_group WHERE (?1='' OR representative_title LIKE ?2 OR demand_institution_name LIKE ?2 OR detailed_product_class_no LIKE ?2 OR representative_winner_name LIKE ?2 OR representative_contract_name LIKE ?2) AND (?3='all' OR item_category=?3) ORDER BY representative_date DESC,procurement_group_id DESC LIMIT ?4",
      "bid"=>"SELECT b.bid_notice_id,b.notice_posted_local,b.bid_ntce_name,b.demand_institution_name,b.detailed_product_class_no,b.detailed_product_class_name,COALESCE((SELECT d.category FROM detailed_product_category d WHERE d.detailed_product_class_no=b.detailed_product_class_no AND d.category IS NOT NULL ORDER BY d.updated_at DESC LIMIT 1),'unknown'),NULL,NULL,NULL,NULL,NULL,1,0,0,'UNLINKED' FROM bid_notice b WHERE (?1='' OR b.bid_ntce_name LIKE ?2 OR b.demand_institution_name LIKE ?2 OR b.bid_ntce_no LIKE ?2 OR b.detailed_product_class_no LIKE ?2) AND (?3='all' OR EXISTS(SELECT 1 FROM detailed_product_category d WHERE d.detailed_product_class_no=b.detailed_product_class_no AND d.category=?3)) ORDER BY b.notice_posted_local DESC,b.bid_notice_id DESC LIMIT ?4",
      _=>"SELECT c.contract_result_id,c.contract_date,c.contract_name,c.contract_institution_name,c.target_detailed_product_class_no,COALESCE((SELECT product_class_name||CASE WHEN count(*)>1 THEN ' 외 '||(count(*)-1)||'건' ELSE '' END FROM contract_item i JOIN contract_header h ON h.contract_header_id=i.contract_header_id WHERE h.decision_contract_no=c.decision_contract_no),''),COALESCE((SELECT d.category FROM detailed_product_category d WHERE d.detailed_product_class_no=c.target_detailed_product_class_no AND d.category IS NOT NULL ORDER BY d.updated_at DESC LIMIT 1),'unknown'),(SELECT corporation_name||CASE WHEN (SELECT count(*) FROM contract_corporation x WHERE x.contract_result_id=c.contract_result_id)>1 THEN ' 외 '||((SELECT count(*) FROM contract_corporation x WHERE x.contract_result_id=c.contract_result_id)-1)||'개' ELSE '' END FROM contract_corporation x WHERE x.contract_result_id=c.contract_result_id ORDER BY CASE role_name WHEN '주계약업체' THEN 0 ELSE 1 END,sequence_no LIMIT 1),NULL,c.contract_method_name,c.contract_name,c.contract_amount,0,0,1,'UNLINKED' FROM contract_result c WHERE (?1='' OR c.contract_name LIKE ?2 OR c.contract_institution_name LIKE ?2 OR c.demand_institution_name LIKE ?2 OR c.decision_contract_no LIKE ?2 OR c.target_detailed_product_class_no LIKE ?2 OR EXISTS(SELECT 1 FROM contract_corporation x WHERE x.contract_result_id=c.contract_result_id AND x.corporation_name LIKE ?2)) AND (?3='all' OR EXISTS(SELECT 1 FROM detailed_product_category d WHERE d.detailed_product_class_no=c.target_detailed_product_class_no AND d.category=?3)) ORDER BY c.contract_date DESC,c.contract_result_id DESC LIMIT ?4"};
    let rows=db.prepare(sql).map_err(|e|e.to_string())?.query_map(params![q,pattern,category,limit],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"date":value_or_empty(r,1),"name":value_or_empty(r,2),"demandInstitution":value_or_empty(r,3),"productClassNo":value_or_empty(r,4),"productClassName":value_or_empty(r,5),"productCategory":value_or_empty(r,6),"winnerName":value_or_empty(r,7),"awardAmount":r.get::<_,Option<i64>>(8)?,"awardRate":value_or_empty(r,9),"contractName":value_or_empty(r,10),"contractAmount":r.get::<_,Option<i64>>(11)?,"bidCount":r.get::<_,i64>(12)?,"awardCount":r.get::<_,i64>(13)?,"contractCount":r.get::<_,i64>(14)?,"matchStatus":value_or_empty(r,15)}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(json!({"rows":rows}))
}

fn raw_text(raw: &Value, keys: &[&str]) -> String {
    keys.iter().find_map(|key| raw.get(*key)).and_then(|value| match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_owned()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }).unwrap_or_default()
}
fn raw_value(raw: &Value, keys: &[&str]) -> Value {
    keys.iter().find_map(|key| raw.get(*key)).cloned().unwrap_or(Value::Null)
}
fn parse_raw(text: &str) -> Value { serde_json::from_str(text).unwrap_or_else(|_| json!({})) }
fn corp_members(value: Value) -> Vec<Value> {
    if let Value::String(text)=&value { let source=text.trim(); if source.starts_with('[')&&source.ends_with(']')&&source.contains('^') { return source[1..source.len()-1].split("] ,[").flat_map(|chunk|chunk.split("],[")).filter_map(|chunk|{let p=chunk.split('^').collect::<Vec<_>>();let name=p.get(3).copied().unwrap_or("").trim();if name.is_empty(){None}else{Some(json!({"sequence":p.first().copied().unwrap_or(""),"role":p.get(1).copied().unwrap_or(""),"consortiumMethod":p.get(2).copied().unwrap_or(""),"name":name,"representative":p.get(4).copied().unwrap_or(""),"country":p.get(5).copied().unwrap_or(""),"shareRate":p.get(6).copied().unwrap_or(""),"businessNo":p.get(9).copied().unwrap_or("")}))}}).collect(); } }
    let value=match value { Value::String(text)=>serde_json::from_str(&text).unwrap_or(Value::Null), other=>other };
    let list=match value { Value::Array(items)=>items, Value::Object(mut object)=>object.remove("item").or_else(||object.remove("items")).map(|v|match v{Value::Array(a)=>a,one=>vec![one]}).unwrap_or_default(), _=>vec![] };
    list.into_iter().filter_map(|corp| { let name=raw_text(&corp,&["corpNm","cntrctCorpNm","entrpsNm"]); if name.is_empty(){None}else{Some(json!({"name":name,"businessNo":raw_text(&corp,&["bizno","corpBizno","cntrctCorpBizno"]),"consortiumMethod":raw_text(&corp,&["cmmnCntrctMthdNm","cmmnDprMthdNm","jointContractMethodName"]),"shareRate":raw_text(&corp,&["cntrctShareRate","shareRate","jntcontrRate"])}))} }).collect()
}

#[tauri::command]
fn procurement_group_detail(app: AppHandle, group_id: i64) -> Result<Value, String> {
    let db=connection(&app)?;
    let bids=db.prepare("SELECT b.bid_notice_id,b.bid_ntce_no,b.bid_ntce_ord,b.bid_ntce_name,b.notice_posted_local,b.demand_institution_name FROM procurement_group_member m JOIN bid_notice b ON m.source_type='BID' AND b.bid_notice_id=m.source_id WHERE m.procurement_group_id=? ORDER BY b.notice_posted_local,b.bid_notice_id").map_err(|e|e.to_string())?.query_map([group_id],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"number":value_or_empty(r,1),"order":value_or_empty(r,2),"name":value_or_empty(r,3),"date":value_or_empty(r,4),"institution":value_or_empty(r,5)}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let awards=db.prepare("SELECT a.award_result_id,a.bid_ntce_name,a.winner_name,a.winner_business_no,a.successful_bid_amount,a.successful_bid_rate,a.real_opening_local FROM procurement_group_member m JOIN award_result a ON m.source_type='AWARD' AND a.award_result_id=m.source_id WHERE m.procurement_group_id=? ORDER BY a.real_opening_local,a.award_result_id").map_err(|e|e.to_string())?.query_map([group_id],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":value_or_empty(r,1),"winner":value_or_empty(r,2),"businessNo":value_or_empty(r,3),"amount":r.get::<_,Option<i64>>(4)?,"rate":value_or_empty(r,5),"date":value_or_empty(r,6)}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let contracts=db.prepare("SELECT c.contract_result_id,c.decision_contract_no,c.contract_no,c.contract_name,c.contract_amount,c.contract_date,c.demand_institution_name FROM procurement_group_member m JOIN contract_result c ON m.source_type='CONTRACT' AND c.contract_result_id=m.source_id WHERE m.procurement_group_id=? ORDER BY c.contract_date,c.contract_result_id").map_err(|e|e.to_string())?.query_map([group_id],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"decisionNo":value_or_empty(r,1),"contractNo":value_or_empty(r,2),"name":value_or_empty(r,3),"amount":r.get::<_,Option<i64>>(4)?,"date":value_or_empty(r,5),"institution":value_or_empty(r,6)}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(json!({"bids":bids,"awards":awards,"contracts":contracts}))
}

#[tauri::command]
fn notice_detail(app: AppHandle, bid_notice_id: i64) -> Result<Value, String> {
    let db = connection(&app)?;
    let notice=db.query_row("SELECT bid_ntce_name,notice_institution_name,demand_institution_name,notice_posted_local,bid_begin_local,bid_close_local,opening_local,estimated_price,allocated_budget_amount,product_specification,notice_url,notice_kind_name,registration_type_name,contract_method_name,bid_method_name,award_method_name,source_raw_item_id,bid_ntce_no,bid_ntce_ord FROM bid_notice WHERE bid_notice_id=?1",[bid_notice_id],|r|Ok((json!({"name":value_or_empty(r,0),"institution":value_or_empty(r,1),"demandInstitution":value_or_empty(r,2),"postedAt":value_or_empty(r,3),"bidBegin":value_or_empty(r,4),"bidClose":value_or_empty(r,5),"opening":value_or_empty(r,6),"estimatedPrice":r.get::<_,Option<i64>>(7).unwrap_or(None),"budget":r.get::<_,Option<i64>>(8).unwrap_or(None),"specification":value_or_empty(r,9),"url":value_or_empty(r,10),"noticeKind":value_or_empty(r,11),"registrationType":value_or_empty(r,12),"contractMethod":value_or_empty(r,13),"bidMethod":value_or_empty(r,14),"awardMethod":value_or_empty(r,15),"bidNo":value_or_empty(r,17),"bidOrd":value_or_empty(r,18)}),r.get::<_,i64>(16)?))).optional().map_err(|e|e.to_string())?.ok_or("공고를 찾을 수 없습니다.")?;
    let bid_no=notice.0["bidNo"].as_str().unwrap_or("");let bid_ord=notice.0["bidOrd"].as_str().unwrap_or("");
    let raw=parse_raw(&db.query_row("SELECT canonical_json FROM api_raw_item WHERE raw_item_id=?1",[notice.1],|r|r.get::<_,String>(0)).unwrap_or_default());
    let items=db.prepare("SELECT product_class_name,detailed_product_class_name,product_specification,quantity,unit,unit_price,delivery_deadline_local,delivery_day_count,delivery_place,delivery_condition_name,detailed_product_class_no,COALESCE((SELECT CASE c.cmpnt_yn WHEN 'Y' THEN 'part' WHEN 'N' THEN 'product' END FROM api_raw_item a JOIN catalog_item_category c ON c.prdct_idnt_no=json_extract(a.canonical_json,'$.prdctIdntNo') WHERE a.raw_item_id=bid_item.source_raw_item_id),'unknown') FROM bid_item WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2").map_err(|e|e.to_string())?.query_map(params![bid_no,bid_ord],|r|Ok(json!({"className":value_or_empty(r,0),"detailClassName":value_or_empty(r,1),"specification":value_or_empty(r,2),"quantity":value_or_empty(r,3),"unit":value_or_empty(r,4),"unitPrice":r.get::<_,Option<i64>>(5).unwrap_or(None),"deliveryDeadline":value_or_empty(r,6),"deliveryDays":value_or_empty(r,7),"deliveryPlace":value_or_empty(r,8),"deliveryCondition":value_or_empty(r,9),"detailClassNo":value_or_empty(r,10),"category":value_or_empty(r,11)}))).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>();
    let basis=db.query_row("SELECT basis_amount,evaluation_basis_amount FROM bid_basis_amount WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2 LIMIT 1",params![bid_no,bid_ord],|r|Ok(json!({"basisAmount":r.get::<_,Option<i64>>(0).unwrap_or(None),"evaluationBasisAmount":r.get::<_,Option<i64>>(1).unwrap_or(None)}))).optional().map_err(|e|e.to_string())?;
    let regions=db.prepare("SELECT participation_region_name FROM bid_participation_region WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2 ORDER BY limit_sequence,bid_participation_region_id").map_err(|e|e.to_string())?.query_map(params![bid_no,bid_ord],|r|r.get::<_,Option<String>>(0)).map_err(|e|e.to_string())?.filter_map(Result::ok).flatten().collect::<Vec<_>>();
    let licenses=db.prepare("SELECT license_limit_name,allowed_industry_list FROM bid_license_limit WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2 ORDER BY limit_group_no,limit_sequence,bid_license_limit_id").map_err(|e|e.to_string())?.query_map(params![bid_no,bid_ord],|r|Ok(json!({"name":value_or_empty(r,0),"allowedIndustries":value_or_empty(r,1)}))).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>();
    Ok(json!({"notice":notice.0,"items":items,"basis":basis,"regions":regions,"licenses":licenses,"raw":{"awardCriteria":raw_text(&raw,&["sucsfbidMthdAplyStdCtn","sucsfbidMthdAplyStdCn","sucsfbidMthdAplyStd"]),"consortium":raw_text(&raw,&["cmmnSpldmdAgrmntRcptdocMethd","cmmnSpldmdAgrmntRcptdocMthd","cmmnSpldmdCnum"]),"lowerLimitRate":raw_text(&raw,&["sucsfbidLwltRate","낙찰하한율"])}}))
}

#[tauri::command]
fn award_detail(app:AppHandle, award_result_id:i64)->Result<Value,String>{
    let db=connection(&app)?;
    let award=db.query_row("SELECT bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no,bid_ntce_name,winner_name,winner_business_no,successful_bid_amount,successful_bid_rate,participant_count,real_opening_local FROM award_result WHERE award_result_id=?1",[award_result_id],|r|Ok(json!({"bidNo":value_or_empty(r,0),"bidOrd":value_or_empty(r,1),"bidClassNo":value_or_empty(r,2),"rebidNo":value_or_empty(r,3),"name":value_or_empty(r,4),"winnerName":value_or_empty(r,5),"winnerBusinessNo":value_or_empty(r,6),"successfulBidAmount":r.get::<_,Option<i64>>(7)?,"successfulBidRate":value_or_empty(r,8),"participantCount":r.get::<_,Option<i64>>(9)?,"opening":value_or_empty(r,10)}))).optional().map_err(|e|e.to_string())?.ok_or("낙찰 결과를 찾을 수 없습니다.")?;
    let key=params![award["bidNo"].as_str().unwrap_or(""),award["bidOrd"].as_str().unwrap_or(""),award["bidClassNo"].as_str().unwrap_or(""),award["rebidNo"].as_str().unwrap_or("")];
    let participants=db.prepare("SELECT opening_rank,bidder_name,bidder_business_no,bid_amount,bid_rate,COALESCE(NULLIF(remark,''),opening_result_type_name) FROM opening_participant WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2 AND bid_clsfc_no=?3 AND rbid_no=?4 ORDER BY CASE WHEN CAST(opening_rank AS INTEGER)>0 THEN CAST(opening_rank AS INTEGER) ELSE 2147483647 END,opening_participant_id").map_err(|e|e.to_string())?.query_map(key,|r|Ok(json!({"rank":value_or_empty(r,0),"name":value_or_empty(r,1),"businessNo":value_or_empty(r,2),"amount":r.get::<_,Option<i64>>(3)?,"rate":value_or_empty(r,4),"result":value_or_empty(r,5)}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let prelim=db.query_row("SELECT planned_price,basis_amount,actual_opening_datetime FROM opening_preliminary_price WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2 AND bid_clsfc_no=?3 AND rbid_no=?4 ORDER BY opening_preliminary_price_id LIMIT 1",params![award["bidNo"].as_str().unwrap_or(""),award["bidOrd"].as_str().unwrap_or(""),award["bidClassNo"].as_str().unwrap_or(""),award["rebidNo"].as_str().unwrap_or("")],|r|Ok(json!({"plannedPrice":r.get::<_,Option<i64>>(0)?,"basisAmount":r.get::<_,Option<i64>>(1)?,"opening":value_or_empty(r,2)}))).optional().map_err(|e|e.to_string())?;
    let failures=db.prepare("SELECT opening_result_type_name,failure_reason FROM opening_failure_event WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2 AND bid_clsfc_no=?3 AND rbid_no=?4 ORDER BY opening_failure_event_id").map_err(|e|e.to_string())?.query_map(params![award["bidNo"].as_str().unwrap_or(""),award["bidOrd"].as_str().unwrap_or(""),award["bidClassNo"].as_str().unwrap_or(""),award["rebidNo"].as_str().unwrap_or("")],|r|Ok(json!({"type":value_or_empty(r,0),"reason":value_or_empty(r,1)}))).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>();
    let rebids=db.prepare("SELECT opening_result_type_name,bid_deadline_datetime,opening_datetime,rebid_reason FROM opening_rebid_event WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2 AND bid_clsfc_no=?3 AND rbid_no=?4 ORDER BY opening_rebid_event_id").map_err(|e|e.to_string())?.query_map(params![award["bidNo"].as_str().unwrap_or(""),award["bidOrd"].as_str().unwrap_or(""),award["bidClassNo"].as_str().unwrap_or(""),award["rebidNo"].as_str().unwrap_or("")],|r|Ok(json!({"type":value_or_empty(r,0),"bidDeadline":value_or_empty(r,1),"opening":value_or_empty(r,2),"reason":value_or_empty(r,3)}))).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>();
    Ok(json!({"award":award,"participants":participants,"preliminary":prelim,"failures":failures,"rebids":rebids}))
}

#[tauri::command]
fn contract_detail(app:AppHandle, contract_result_id:i64)->Result<Value,String>{
    let db=connection(&app)?;
    let result=db.query_row("SELECT decision_contract_no,contract_no,contract_name,contract_method_name,contract_institution_name,demand_institution_name,contract_amount,contract_date,source_raw_item_id FROM contract_result WHERE contract_result_id=?1",[contract_result_id],|r|Ok((json!({"decisionNo":value_or_empty(r,0),"contractNo":value_or_empty(r,1),"name":value_or_empty(r,2),"method":value_or_empty(r,3),"institution":value_or_empty(r,4),"demandInstitution":value_or_empty(r,5),"amount":r.get::<_,Option<i64>>(6)?,"date":value_or_empty(r,7)}),r.get::<_,i64>(8)?))).optional().map_err(|e|e.to_string())?.ok_or("계약 결과를 찾을 수 없습니다.")?;
    let header=db.query_row("SELECT contract_header_id,raw_json FROM contract_header WHERE decision_contract_no=?1 OR contract_ref_no=?1 OR unty_cntrct_no=?2 ORDER BY contract_header_id LIMIT 1",params![result.0["decisionNo"].as_str().unwrap_or(""),result.0["contractNo"].as_str().unwrap_or("")],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?))).optional().map_err(|e|e.to_string())?;
    let raw=header.as_ref().map(|(_,text)|parse_raw(text)).unwrap_or_else(||db.query_row("SELECT canonical_json FROM api_raw_item WHERE raw_item_id=?1",[result.1],|r|r.get::<_,String>(0)).map(|text|parse_raw(&text)).unwrap_or_else(|_|json!({})));
    let items=if let Some((header_id,_))=header{db.prepare("SELECT product_class_name,korean_product_name,product_identification_no,quantity,unit_price_amount,product_amount,raw_json FROM contract_item WHERE contract_header_id=?1 ORDER BY contract_item_id").map_err(|e|e.to_string())?.query_map([header_id],|r|{let item_raw=parse_raw(&r.get::<_,String>(6)?);let product_id=value_or_empty(r,2);let category=if product_id.is_empty(){String::new()}else{db.query_row("SELECT CASE cmpnt_yn WHEN 'Y' THEN 'part' WHEN 'N' THEN 'product' END FROM catalog_item_category WHERE prdct_idnt_no=?1",[&product_id],|x|x.get::<_,String>(0)).unwrap_or_default()};Ok(json!({"className":value_or_empty(r,0),"name":value_or_empty(r,1),"productId":product_id,"quantity":value_or_empty(r,3),"unit":raw_text(&item_raw,&["unit","unitNm","prdctUnit"]),"unitPrice":value_or_empty(r,4),"amount":value_or_empty(r,5),"delivery":raw_text(&item_raw,&["dlvrTmlmtDt","dlvrPlce","dlvryCndtnNm","dlvrInfo"]),"category":if category.is_empty(){"unknown"}else{&category}}))}).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>()}else{vec![]};
    Ok(json!({"contract":result.0,"raw":{"contractRefNo":raw_text(&raw,&["cntrctRefNo"]),"unifiedNo":raw_text(&raw,&["untyCntrctNo"]),"registeredAt":raw_text(&raw,&["rgstDt"]),"period":raw_text(&raw,&["cntrctPrd"]),"businessType":raw_text(&raw,&["bsnsDivNm"]),"totalAmount":raw_value(&raw,&["totCntrctAmt"]),"baseLaw":raw_text(&raw,&["baseLawNm"]),"baseDetails":raw_text(&raw,&["baseDtls"]),"payment":raw_text(&raw,&["payDivNm"]),"longTerm":raw_text(&raw,&["lngtrmCtnuDivNm"]),"commonContractYn":raw_text(&raw,&["cmmnCntrctYn"]),"guaranteeRate":raw_text(&raw,&["grntymnyRate"]),"delayRate":raw_text(&raw,&["dfrcmpnstRt"]),"institutionCode":raw_text(&raw,&["cntrctInsttCd"]),"institutionDivision":raw_text(&raw,&["cntrctInsttJrsdctnDivNm"]),"department":raw_text(&raw,&["cntrctInsttChrgDeptNm"]),"officer":raw_text(&raw,&["cntrctInsttOfclNm"]),"officerTel":raw_text(&raw,&["cntrctInsttOfclTelNo"]),"officerFax":raw_text(&raw,&["cntrctInsttOfclFaxNo"]),"creditor":raw_text(&raw,&["crdtrNm"]),"requestNo":raw_text(&raw,&["reqNo"]),"noticeNo":raw_text(&raw,&["ntceNo"]),"detailUrl":raw_text(&raw,&["cntrctDtlInfoUrl"])},"corporations":corp_members(raw_value(&raw,&["corpList"])),"items":items}))
}

#[tauri::command]
fn collector_status(app: AppHandle, state: State<CollectorState>) -> Result<Value, String> {
    let running = state
        .0
        .lock()
        .ok()
        .and_then(|mut g| g.as_mut().map(|c| c.try_wait().ok().flatten().is_none()))
        .unwrap_or(false);
    match connection(&app) {
        Ok(db) => {
            let checkpoint=db.query_row("SELECT checkpoint_at FROM collector_checkpoint ORDER BY checkpoint_at DESC LIMIT 1",[],|r|r.get::<_,Option<String>>(0)).unwrap_or(None);
            let has_initial=db.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='initial_collection_job'",[],|r|r.get::<_,i64>(0)).unwrap_or(0)>0;
            let job = if has_initial {
                db.query_row("SELECT job_id,status,(SELECT max(successful_through_month) FROM initial_collection_target WHERE job_id=initial_collection_job.job_id) FROM initial_collection_job ORDER BY updated_at DESC LIMIT 1",[],|r|Ok(json!({"jobId":value_or_empty(r,0),"status":value_or_empty(r,1),"through":value_or_empty(r,2)}))).optional().unwrap_or(None)
            } else {
                None
            };
            let award_job=if db.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='award_collection_job'",[],|r|r.get::<_,i64>(0)).unwrap_or(0)>0{db.query_row("SELECT job_id,status,(SELECT max(successful_through_month) FROM award_collection_target WHERE job_id=award_collection_job.job_id) FROM award_collection_job ORDER BY updated_at DESC LIMIT 1",[],|r|Ok(json!({"jobId":value_or_empty(r,0),"status":value_or_empty(r,1),"through":value_or_empty(r,2)}))).optional().unwrap_or(None)}else{None};
            let contract_job=if db.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='contract_collection_job'",[],|r|r.get::<_,i64>(0)).unwrap_or(0)>0{db.query_row("SELECT job_id,status,(SELECT max(successful_through_month) FROM contract_collection_target WHERE job_id=contract_collection_job.job_id) FROM contract_collection_job ORDER BY updated_at DESC LIMIT 1",[],|r|Ok(json!({"jobId":value_or_empty(r,0),"status":value_or_empty(r,1),"through":value_or_empty(r,2)}))).optional().unwrap_or(None)}else{None};
            let lifecycle=if db.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='lifecycle_collection_state'",[],|r|r.get::<_,i64>(0)).unwrap_or(0)>0{
                let count=|status:&str|db.query_row("SELECT count(*) FROM lifecycle_collection_state WHERE status=?1",[status],|r|r.get::<_,i64>(0)).unwrap_or(0);
                let success=count("SUCCESS");let no_data=count("NO_DATA");let failed=count("FAILED");let running_count=count("RUNNING");
                let current=db.query_row("SELECT b.bid_ntce_no FROM lifecycle_collection_state s JOIN bid_notice b ON b.bid_notice_id=s.bid_notice_id WHERE s.status='RUNNING' ORDER BY s.updated_at DESC LIMIT 1",[],|r|r.get::<_,String>(0)).optional().unwrap_or(None);
                let target=db.query_row("SELECT count(*) FROM bid_notice",[],|r|r.get::<_,i64>(0)).unwrap_or(0);
                let linked_awards=db.query_row("SELECT count(*) FROM bid_award_link WHERE relationship_source='official_integrated_api' AND match_status='official_matched'",[],|r|r.get::<_,i64>(0)).unwrap_or(0);
                let linked_contracts=db.query_row("SELECT count(*) FROM bid_contract_link WHERE relationship_source='official_integrated_api' AND match_status='official_matched'",[],|r|r.get::<_,i64>(0)).unwrap_or(0);
                json!({"target":target,"pending":count("PENDING"),"running":running_count,"success":success,"noData":no_data,"failed":failed,"processed":success+no_data+failed,"currentBidNtceNo":current,"linkedAwards":linked_awards,"linkedContracts":linked_contracts})
            }else{json!({"target":0,"pending":0,"running":0,"success":0,"noData":0,"failed":0,"processed":0,"currentBidNtceNo":null,"linkedAwards":0,"linkedContracts":0})};
            Ok(
                json!({"ready":true,"running":running,"checkpoint":checkpoint,"job":job,"awardJob":award_job,"contractJob":contract_job,"lifecycle":lifecycle}),
            )
        }
        Err(_) => Ok(
            json!({"ready":false,"running":running,"checkpoint":null,"job":null,"awardJob":null}),
        ),
    }
}

fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        Ok(std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join("runtime"))
    } else {
        Ok(app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("runtime"))
    }
}
fn pause_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_dir(app)?.join("collector.pause"))
}
#[cfg(debug_assertions)]
fn development_env_has_key(root: &std::path::Path) -> bool {
    let Ok(text) = fs::read_to_string(root.join(".env")) else {
        return false;
    };
    text.lines().any(|line| {
        let line = line.trim();
        if line.starts_with('#') {
            return false;
        }
        let Some((name, value)) = line.split_once('=') else {
            return false;
        };
        name.trim() == "KONEPS_SERVICE_KEY" && !value.trim().trim_matches(['\"', '\'']).is_empty()
    })
}
fn configure_koneps_environment(command: &mut Command) -> Result<&'static str, String> {
    if std::env::var("KONEPS_SERVICE_KEY")
        .ok()
        .is_some_and(|v| !v.trim().is_empty())
    {
        return Ok("environment");
    }
    #[cfg(debug_assertions)]
    {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("개발 프로젝트 루트를 확인할 수 없습니다.")?;
        if development_env_has_key(root) {
            command.env("MARKET_PROJECT_ROOT", root);
            return Ok("development");
        }
    }
    if let Some(stored) = credentials::read()? {
        command
            .env("KONEPS_SERVICE_KEY", stored.service_key)
            .env("KONEPS_SERVICE_KEY_MODE", stored.mode);
        return Ok("wcm");
    }
    Ok("none")
}
fn target_search_command(app: &AppHandle, query: &str) -> Result<Value, String> {
    let runtime = runtime_dir(app)?;
    let mut command = Command::new(runtime.join("node.exe"));
    command
        .arg("collector/orchestration/target-search-cli.js")
        .arg(query)
        .current_dir(&runtime)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    configure_koneps_environment(&mut command)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command
        .output()
        .map_err(|_| "Target 검색기를 실행할 수 없습니다.".to_string())?;
    if !output.status.success() {
        return Err("Target 검색기가 정상 종료되지 않았습니다.".into());
    }
    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| "Target 검색 응답을 읽을 수 없습니다.".to_string())?;
    serde_json::from_str(stdout.trim())
        .map_err(|_| "Target 검색 응답 형식이 올바르지 않습니다.".to_string())
}
#[tauri::command]
fn api_key_status() -> Result<Value, String> {
    let stored = credentials::read()?.is_some();
    let source = if std::env::var("KONEPS_SERVICE_KEY")
        .ok()
        .is_some_and(|v| !v.trim().is_empty())
    {
        "environment"
    } else {
        #[cfg(debug_assertions)]
        {
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap_or(std::path::Path::new("."));
            if development_env_has_key(root) {
                return Ok(
                    json!({"stored":stored,"source":"development","credentialName":credentials::TARGET}),
                );
            }
        }
        if stored {
            "wcm"
        } else {
            "none"
        }
    };
    Ok(json!({"stored":stored,"source":source,"credentialName":credentials::TARGET}))
}
#[tauri::command]
fn save_api_key(service_key: String, mode: String) -> Result<Value, String> {
    let key = service_key.trim();
    if key.is_empty() {
        return Err("API 키를 입력하세요.".into());
    }
    if mode != "preserve" && mode != "encode" {
        return Err("키 모드는 preserve 또는 encode여야 합니다.".into());
    }
    credentials::write(key, &mode)?;
    Ok(json!({"stored":true}))
}
#[tauri::command]
fn test_api_key(app: AppHandle) -> Result<Value, String> {
    let result = target_search_command(&app, "4015155301")?;
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(json!({"ok":true,"resultCode":"00"}))
    } else {
        Ok(json!({"ok":false,"resultCode":result.get("resultCode"),"error":result.get("error")}))
    }
}
#[tauri::command]
fn search_collection_targets(app: AppHandle, query: String) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 100 {
        return Err("세부품명 또는 8/10자리 번호를 입력하세요.".into());
    }
    target_search_command(&app, query)
}
#[tauri::command]
fn start_collection(
    app: AppHandle,
    state: State<CollectorState>,
    mode: String,
    targets: Option<Value>,
    contract_action: Option<String>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "collector state lock failed")?;
    if guard.as_mut().and_then(|c| c.try_wait().ok()).is_none() && guard.is_some() {
        return Err("수집기가 이미 실행 중입니다.".into());
    }
    let runtime = runtime_dir(&app)?;
    let db = db_path(&app)?;
    let pause_file = pause_path(&app)?;
    let _ = fs::remove_file(&pause_file);
    let mut args = vec!["collector/orchestration/cli.js".to_string()];
    if mode == "lifecycle" {
        args[0] = "collector/orchestration/lifecycle-cli.js".into();
    } else if mode == "award" || mode == "contract" {
        if mode == "contract" {
            let action = contract_action.as_deref().unwrap_or("resume");
            if !matches!(action, "fresh" | "resume") {
                return Err("지원하지 않는 계약 수집 동작입니다.".into());
            }
            args.extend(["--action".into(), action.into()]);
        }
        args[0] = if mode == "award" {
            "collector/orchestration/award-cli.js".into()
        } else {
            "collector/orchestration/contract-cli.js".into()
        };
        args.extend([
            "--targets".into(),
            serde_json::to_string(&targets.unwrap_or_else(|| json!([])))
                .map_err(|e| e.to_string())?,
        ]);
    } else if mode == "initial" || mode == "historical" {
        args[0] = "collector/orchestration/initial-cli.js".into();
        args.extend([
            "--targets".into(),
            serde_json::to_string(&targets.unwrap_or_else(|| json!([])))
                .map_err(|e| e.to_string())?,
        ]);
    } else {
        args.push(mode.clone());
        args.push("--execute".into());
    }
    let mut command = Command::new(runtime.join("node.exe"));
    let env_source = configure_koneps_environment(&mut command)?;
    command
        .args(args)
        .current_dir(&runtime)
        .env("MARKET_DB_PATH", &db)
        .env("MARKET_COLLECTOR_PAUSE_FILE", &pause_file)
        .env("MARKET_COLLECTOR_KIND", &mode)
        .env("MARKET_COLLECTOR_DIAGNOSTICS", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let _ = app.emit("collector-event", json!({
        "type":"COLLECTOR_SPAWN",
        "collector":mode,
        "executable":runtime.join("node.exe"),
        "argv":command.get_args().map(|arg|arg.to_string_lossy()).collect::<Vec<_>>(),
        "cwd":runtime,
        "databasePath":db,
        "environmentSource":env_source,
        "serviceKeyPresent":env_source!="none",
        "nodeEnv":std::env::var("NODE_ENV").ok(),
        "httpProxyPresent":std::env::var("HTTP_PROXY").ok().is_some(),
        "httpsProxyPresent":std::env::var("HTTPS_PROXY").ok().is_some(),
    }));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Collector를 시작할 수 없습니다.".to_string())?;
    if let Some(out) = child.stdout.take() {
        let handle = app.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let event = serde_json::from_str::<Value>(&line)
                    .unwrap_or_else(|_| json!({"type":"log","message":line}));
                let _ = handle.emit("collector-event", event);
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let handle = app.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if !line.contains("ServiceKey") {
                    let _ = handle.emit("collector-event", json!({"type":"error","message":line}));
                }
            }
        });
    }
    let child_id = child.id();
    *guard = Some(child);
    drop(guard);
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let state = handle.state::<CollectorState>();
        let exit = {
            let Ok(mut guard) = state.0.lock() else {
                return;
            };
            let Some(child) = guard.as_mut() else { return };
            if child.id() != child_id {
                return;
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    *guard = None;
                    Some((status.success(), status.code()))
                }
                Ok(None) => None,
                Err(_) => {
                    *guard = None;
                    Some((false, None))
                }
            }
        };
        if let Some((success, exit_code)) = exit {
            let _ = handle.emit(
                "collector-event",
                json!({"type":"COLLECTOR_EXIT","success":success,"exitCode":exit_code,"signal":Value::Null}),
            );
            return;
        }
    });
    Ok(())
}
#[tauri::command]
fn pause_collection(app: AppHandle, state: State<CollectorState>) -> Result<(), String> {
    let running = state
        .0
        .lock()
        .map_err(|_| "collector state lock failed")?
        .as_mut()
        .is_some_and(|child| child.try_wait().ok().flatten().is_none());
    if running {
        fs::write(pause_path(&app)?, b"pause").map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn stop_collection(state: State<CollectorState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "collector state lock failed")?;
    if let Some(child) = guard.as_mut() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CollectorState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            dashboard_summary,
            search_awards,
            search_procurements,
            procurement_group_detail,
            notice_detail,
            award_detail,
            contract_detail,
            collector_status,
            api_key_status,
            save_api_key,
            test_api_key,
            search_collection_targets,
            start_collection,
            pause_collection,
            stop_collection
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
