use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
mod credentials {
    use serde::{Deserialize, Serialize};
    use std::{ffi::c_void, ptr};
    use windows_sys::Win32::{Foundation::{ERROR_NOT_FOUND, FILETIME}, Security::Credentials::{CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC}};
    pub const TARGET: &str = "MonaRadar/Market/KONEPS";
    #[derive(Serialize, Deserialize)] pub struct StoredCredential { pub service_key: String, pub mode: String }
    fn wide(value:&str)->Vec<u16>{value.encode_utf16().chain(Some(0)).collect()}
    pub fn write(service_key:&str,mode:&str)->Result<(),String>{
        let target=wide(TARGET);let username=wide("KONEPS_SERVICE_KEY");
        let mut blob=serde_json::to_vec(&StoredCredential{service_key:service_key.to_owned(),mode:mode.to_owned()}).map_err(|_|"Credential serialization failed".to_string())?;
        let credential=CREDENTIALW{Flags:0,Type:CRED_TYPE_GENERIC,TargetName:target.as_ptr() as *mut _,Comment:ptr::null_mut(),LastWritten:FILETIME{dwLowDateTime:0,dwHighDateTime:0},CredentialBlobSize:blob.len() as u32,CredentialBlob:blob.as_mut_ptr(),Persist:CRED_PERSIST_LOCAL_MACHINE,AttributeCount:0,Attributes:ptr::null_mut(),TargetAlias:ptr::null_mut(),UserName:username.as_ptr() as *mut _};
        let ok=unsafe{CredWriteW(&credential,0)};blob.fill(0);
        if ok==0{Err("Windows Credential Manager에 API 키를 저장하지 못했습니다.".into())}else{Ok(())}
    }
    pub fn read()->Result<Option<StoredCredential>,String>{
        let target=wide(TARGET);let mut raw:*mut CREDENTIALW=ptr::null_mut();
        if unsafe{CredReadW(target.as_ptr(),CRED_TYPE_GENERIC,0,&mut raw)}==0{return if std::io::Error::last_os_error().raw_os_error()==Some(ERROR_NOT_FOUND as i32){Ok(None)}else{Err("Windows Credential Manager에서 API 키를 읽지 못했습니다.".into())}};
        let result=(||{let credential=unsafe{&*raw};let bytes=unsafe{std::slice::from_raw_parts(credential.CredentialBlob as *const u8,credential.CredentialBlobSize as usize)};serde_json::from_slice::<StoredCredential>(bytes).map(Some).map_err(|_|"저장된 API 키 형식이 올바르지 않습니다.".to_string())})();
        unsafe{CredFree(raw as *const c_void)};result
    }
}
#[cfg(not(windows))]
mod credentials { pub const TARGET:&str="MonaRadar/Market/KONEPS";pub struct StoredCredential{pub service_key:String,pub mode:String}pub fn write(_: &str,_:&str)->Result<(),String>{Err("Windows Credential Manager는 Windows에서만 사용할 수 있습니다.".into())}pub fn read()->Result<Option<StoredCredential>,String>{Ok(None)} }

struct CollectorState(Mutex<Option<Child>>);

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("MonaRadar").join("Market");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("mona-radar-market.sqlite3"))
}
fn connection(app: &AppHandle) -> Result<Connection, String> {
    let path=db_path(app)?;
    if !path.exists() { return Err("아직 수집된 로컬 데이터가 없습니다. Collector에서 초기 수집을 시작하세요.".into()); }
    let db=Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e|e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e|e.to_string())?;
    Ok(db)
}
fn value_or_empty(row: &rusqlite::Row<'_>, i: usize) -> String { row.get::<_,Option<String>>(i).ok().flatten().unwrap_or_default() }

#[tauri::command]
fn dashboard_summary(app: AppHandle) -> Result<Value,String> { let db=connection(&app)?; Ok(json!({
 "notices":db.query_row("SELECT count(*) FROM bid_notice",[],|r|r.get::<_,i64>(0)).unwrap_or(0),
 "items":db.query_row("SELECT count(*) FROM bid_item",[],|r|r.get::<_,i64>(0)).unwrap_or(0),
 "basisAmounts":db.query_row("SELECT count(*) FROM bid_basis_amount",[],|r|r.get::<_,i64>(0)).unwrap_or(0),
 "latestNotice":db.query_row("SELECT max(notice_posted_local) FROM bid_notice",[],|r|r.get::<_,Option<String>>(0)).unwrap_or(None),
 "checkpoint":db.query_row("SELECT checkpoint_at FROM collector_checkpoint ORDER BY checkpoint_at DESC LIMIT 1",[],|r|r.get::<_,Option<String>>(0)).unwrap_or(None),
 "recentRuns": db.prepare("SELECT status,started_at,completed_at,inserted_count,updated_count,unchanged_count,error_summary FROM collector_run ORDER BY started_at DESC LIMIT 8").map_err(|e|e.to_string())?.query_map([],|r|Ok(json!({"status":value_or_empty(r,0),"startedAt":value_or_empty(r,1),"completedAt":value_or_empty(r,2),"inserted":r.get::<_,i64>(3).unwrap_or(0),"updated":r.get::<_,i64>(4).unwrap_or(0),"unchanged":r.get::<_,i64>(5).unwrap_or(0),"error":value_or_empty(r,6)}))).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>()
 })) }

#[tauri::command]
fn search_notices(app:AppHandle, query:Option<String>, status:Option<String>, limit:Option<i64>) -> Result<Value,String>{
 let db=connection(&app)?; let limit=limit.unwrap_or(100).clamp(1,200); let q=query.unwrap_or_default(); let st=status.unwrap_or_default();
 let pattern=format!("%{}%",q); let rows=db.prepare("SELECT bid_ntce_no,bid_ntce_ord,bid_ntce_name,notice_institution_name,demand_institution_name,notice_posted_local,bid_close_local,estimated_price,allocated_budget_amount,notice_kind_name FROM bid_notice WHERE (?1='' OR bid_ntce_name LIKE ?2 OR notice_institution_name LIKE ?2 OR demand_institution_name LIKE ?2) AND (?3='' OR notice_kind_name=?3) ORDER BY notice_posted_local DESC LIMIT ?4").map_err(|e|e.to_string())?.query_map(params![q,pattern,st,limit],|r|Ok(json!({"bidNo":value_or_empty(r,0),"bidOrd":value_or_empty(r,1),"name":value_or_empty(r,2),"institution":value_or_empty(r,3),"demandInstitution":value_or_empty(r,4),"postedAt":value_or_empty(r,5),"closeAt":value_or_empty(r,6),"estimatedPrice":r.get::<_,Option<i64>>(7).unwrap_or(None),"budget":r.get::<_,Option<i64>>(8).unwrap_or(None),"kind":value_or_empty(r,9)}))).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>(); Ok(json!({"rows":rows})) }

#[tauri::command]
fn notice_detail(app:AppHandle,bid_no:String,bid_ord:String)->Result<Value,String>{let db=connection(&app)?;let notice=db.query_row("SELECT bid_ntce_name,notice_institution_name,demand_institution_name,notice_posted_local,bid_begin_local,bid_close_local,opening_local,estimated_price,allocated_budget_amount,product_specification,notice_url FROM bid_notice WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2",params![bid_no,bid_ord],|r|Ok(json!({"name":value_or_empty(r,0),"institution":value_or_empty(r,1),"demandInstitution":value_or_empty(r,2),"postedAt":value_or_empty(r,3),"bidBegin":value_or_empty(r,4),"bidClose":value_or_empty(r,5),"opening":value_or_empty(r,6),"estimatedPrice":r.get::<_,Option<i64>>(7).unwrap_or(None),"budget":r.get::<_,Option<i64>>(8).unwrap_or(None),"specification":value_or_empty(r,9),"url":value_or_empty(r,10)}))).optional().map_err(|e|e.to_string())?.ok_or("공고를 찾을 수 없습니다.")?;let items=db.prepare("SELECT product_class_name,detailed_product_class_name,product_specification,quantity,unit,unit_price FROM bid_item WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2").map_err(|e|e.to_string())?.query_map(params![bid_no,bid_ord],|r|Ok(json!({"className":value_or_empty(r,0),"detailClassName":value_or_empty(r,1),"specification":value_or_empty(r,2),"quantity":value_or_empty(r,3),"unit":value_or_empty(r,4),"unitPrice":r.get::<_,Option<i64>>(5).unwrap_or(None)}))).map_err(|e|e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>();let basis=db.query_row("SELECT basis_amount,evaluation_basis_amount FROM bid_basis_amount WHERE bid_ntce_no=?1 AND bid_ntce_ord=?2 LIMIT 1",params![bid_no,bid_ord],|r|Ok(json!({"basisAmount":r.get::<_,Option<i64>>(0).unwrap_or(None),"evaluationBasisAmount":r.get::<_,Option<i64>>(1).unwrap_or(None)}))).optional().map_err(|e|e.to_string())?;Ok(json!({"notice":notice,"items":items,"basis":basis}))}

#[tauri::command]
fn collector_status(app:AppHandle)->Result<Value,String>{match connection(&app){Ok(db)=>{let checkpoint=db.query_row("SELECT checkpoint_at FROM collector_checkpoint ORDER BY checkpoint_at DESC LIMIT 1",[],|r|r.get::<_,Option<String>>(0)).unwrap_or(None);let job=db.query_row("SELECT job_id,status,successful_through,stop_requested FROM historical_backfill_job ORDER BY updated_at DESC LIMIT 1",[],|r|Ok(json!({"jobId":value_or_empty(r,0),"status":value_or_empty(r,1),"through":value_or_empty(r,2),"stopRequested":r.get::<_,i64>(3).unwrap_or(0)==1}))).optional().unwrap_or(None);Ok(json!({"ready":true,"checkpoint":checkpoint,"job":job}))},Err(_)=>Ok(json!({"ready":false,"checkpoint":null,"job":null}))}}

fn runtime_dir(app:&AppHandle)->Result<PathBuf,String>{if cfg!(debug_assertions){Ok(std::env::current_dir().map_err(|e|e.to_string())?.join("runtime"))}else{Ok(app.path().resource_dir().map_err(|e|e.to_string())?.join("runtime"))}}
#[cfg(debug_assertions)]
fn development_env_has_key(root:&std::path::Path)->bool{let Ok(text)=fs::read_to_string(root.join(".env"))else{return false};text.lines().any(|line|{let line=line.trim();if line.starts_with('#'){return false}let Some((name,value))=line.split_once('=')else{return false};name.trim()=="KONEPS_SERVICE_KEY"&&!value.trim().trim_matches(['\"','\'']).is_empty()})}
fn configure_koneps_environment(command:&mut Command)->Result<&'static str,String>{
 if std::env::var("KONEPS_SERVICE_KEY").ok().is_some_and(|v|!v.trim().is_empty()){return Ok("environment")}
 #[cfg(debug_assertions)]{let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().ok_or("개발 프로젝트 루트를 확인할 수 없습니다.")?;if development_env_has_key(root){command.env("MARKET_PROJECT_ROOT",root);return Ok("development")}}
 if let Some(stored)=credentials::read()?{command.env("KONEPS_SERVICE_KEY",stored.service_key).env("KONEPS_SERVICE_KEY_MODE",stored.mode);return Ok("wcm")}
 Ok("none")
}
fn target_search_command(app:&AppHandle,query:&str)->Result<Value,String>{
 let runtime=runtime_dir(app)?;let mut command=Command::new(runtime.join("node.exe"));
 command.arg("collector/orchestration/target-search-cli.js").arg(query).current_dir(&runtime).stdin(Stdio::null()).stderr(Stdio::null());configure_koneps_environment(&mut command)?;
 #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
 let output=command.output().map_err(|_|"Target 검색기를 실행할 수 없습니다.".to_string())?;if !output.status.success(){return Err("Target 검색기가 정상 종료되지 않았습니다.".into())}let stdout=String::from_utf8(output.stdout).map_err(|_|"Target 검색 응답을 읽을 수 없습니다.".to_string())?;serde_json::from_str(stdout.trim()).map_err(|_|"Target 검색 응답 형식이 올바르지 않습니다.".to_string())
}
#[tauri::command]
fn api_key_status()->Result<Value,String>{let stored=credentials::read()?.is_some();let source=if std::env::var("KONEPS_SERVICE_KEY").ok().is_some_and(|v|!v.trim().is_empty()){"environment"}else{#[cfg(debug_assertions)]{let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap_or(std::path::Path::new("."));if development_env_has_key(root){return Ok(json!({"stored":stored,"source":"development","credentialName":credentials::TARGET}))}}if stored{"wcm"}else{"none"}};Ok(json!({"stored":stored,"source":source,"credentialName":credentials::TARGET}))}
#[tauri::command]
fn save_api_key(service_key:String,mode:String)->Result<Value,String>{let key=service_key.trim();if key.is_empty(){return Err("API 키를 입력하세요.".into())}if mode!="preserve"&&mode!="encode"{return Err("키 모드는 preserve 또는 encode여야 합니다.".into())}credentials::write(key,&mode)?;Ok(json!({"stored":true}))}
#[tauri::command]
fn test_api_key(app:AppHandle)->Result<Value,String>{let result=target_search_command(&app,"4015155301")?;if result.get("ok").and_then(Value::as_bool)==Some(true){Ok(json!({"ok":true,"resultCode":"00"}))}else{Ok(json!({"ok":false,"resultCode":result.get("resultCode"),"error":result.get("error")}))}}
#[tauri::command]
fn search_collection_targets(app:AppHandle,query:String)->Result<Value,String>{
 let query=query.trim();
 if query.is_empty()||query.chars().count()>100{return Err("세부품명 또는 8/10자리 번호를 입력하세요.".into())}
 target_search_command(&app,query)
}
#[tauri::command]
fn start_collection(app:AppHandle,state:State<CollectorState>,mode:String,start:Option<String>,end:Option<String>,job_id:Option<String>)->Result<(),String>{let mut guard=state.0.lock().map_err(|_|"collector state lock failed")?;if guard.as_mut().and_then(|c|c.try_wait().ok()).is_none()&&guard.is_some(){return Err("수집기가 이미 실행 중입니다.".into())}let runtime=runtime_dir(&app)?;let db=db_path(&app)?;let mut args=vec!["collector/orchestration/cli.js".to_string()];if mode=="historical"{args[0]="collector/orchestration/backfill-cli.js".into();args.push("run".into());args.extend(["--job".into(),job_id.ok_or("Historical job ID가 필요합니다.")?,"--max-chunks".into(),"1".into(),"--max-api-calls".into(),"20".into(),"--execute".into()]);}else{args.push(mode.clone());if mode=="initial"{args.extend(["--start".into(),start.ok_or("시작일이 필요합니다.")?,"--end".into(),end.ok_or("종료일이 필요합니다.")?]);}args.push("--execute".into());}let mut command=Command::new(runtime.join("node.exe"));command.args(args).current_dir(&runtime).env("MARKET_DB_PATH",db).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());configure_koneps_environment(&mut command)?;#[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}let mut child=command.spawn().map_err(|_|"Collector를 시작할 수 없습니다.".to_string())?;if let Some(out)=child.stdout.take(){let handle=app.clone();std::thread::spawn(move||{use std::io::{BufRead,BufReader};for line in BufReader::new(out).lines().map_while(Result::ok){let event=serde_json::from_str::<Value>(&line).unwrap_or_else(|_|json!({"type":"log","message":line}));let _=handle.emit("collector-event",event);}});}if let Some(err)=child.stderr.take(){let handle=app.clone();std::thread::spawn(move||{use std::io::{BufRead,BufReader};for line in BufReader::new(err).lines().map_while(Result::ok){if !line.contains("ServiceKey"){let _=handle.emit("collector-event",json!({"type":"error","message":line}));}}});}*guard=Some(child);Ok(())}
#[tauri::command]
fn stop_collection(state:State<CollectorState>)->Result<(),String>{let mut guard=state.0.lock().map_err(|_|"collector state lock failed")?;if let Some(child)=guard.as_mut(){child.kill().map_err(|e|e.to_string())?;}Ok(())}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(){tauri::Builder::default().manage(CollectorState(Mutex::new(None))).invoke_handler(tauri::generate_handler![dashboard_summary,search_notices,notice_detail,collector_status,api_key_status,save_api_key,test_api_key,search_collection_targets,start_collection,stop_collection]).run(tauri::generate_context!()).expect("error while running Tauri application");}
