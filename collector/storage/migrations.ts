export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{
  version: 1,
  name: "phase3c_raw_persistence",
  sql: `
    CREATE TABLE collector_run (
      run_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('period','incremental','verification')),
      requested_range_start TEXT,
      requested_range_end TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','partial','failed','cancelled')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      total_calls INTEGER NOT NULL DEFAULT 0,
      total_items INTEGER NOT NULL DEFAULT 0,
      failed_calls INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT,
      app_version TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX idx_collector_run_started_at ON collector_run(started_at DESC);

    CREATE TABLE collector_operation_run (
      operation_run_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES collector_run(run_id) ON DELETE CASCADE,
      service TEXT NOT NULL,
      operation TEXT NOT NULL,
      query_basis TEXT NOT NULL,
      effective_range_start TEXT,
      effective_range_end TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped','cancelled')),
      page_count INTEGER NOT NULL DEFAULT 0,
      call_count INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      failed_call_count INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(run_id, service, operation, query_basis)
    ) STRICT;
    CREATE INDEX idx_operation_run_run ON collector_operation_run(run_id);
    CREATE INDEX idx_operation_run_operation ON collector_operation_run(service, operation, started_at DESC);

    CREATE TABLE api_response_blob (
      response_blob_id INTEGER PRIMARY KEY,
      response_sha256 TEXT NOT NULL UNIQUE CHECK (length(response_sha256) = 64),
      response_body BLOB NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      content_type TEXT,
      encoding TEXT,
      first_stored_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX idx_response_blob_sha ON api_response_blob(response_sha256);

    CREATE TABLE api_call (
      call_id TEXT PRIMARY KEY,
      operation_run_id TEXT NOT NULL REFERENCES collector_operation_run(operation_run_id) ON DELETE CASCADE,
      service TEXT NOT NULL,
      operation TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
      http_status INTEGER,
      result_code TEXT,
      result_msg TEXT,
      page_no INTEGER NOT NULL CHECK (page_no >= 1),
      num_of_rows INTEGER NOT NULL CHECK (num_of_rows >= 1),
      total_count INTEGER CHECK (total_count IS NULL OR total_count >= 0),
      actual_item_count INTEGER NOT NULL CHECK (actual_item_count >= 0),
      request_metadata_json TEXT NOT NULL CHECK (json_valid(request_metadata_json)),
      redacted_url TEXT NOT NULL CHECK (instr(lower(redacted_url), 'servicekey=') = 0 OR instr(redacted_url, '[REDACTED]') > 0),
      response_blob_id INTEGER REFERENCES api_response_blob(response_blob_id),
      status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
      error_category TEXT,
      parse_status TEXT NOT NULL CHECK (parse_status IN ('succeeded','failed','not_attempted')),
      CHECK ((status = 'succeeded' AND response_blob_id IS NOT NULL AND parse_status = 'succeeded') OR status = 'failed')
    ) STRICT;
    CREATE INDEX idx_api_call_operation_run ON api_call(operation_run_id, page_no);
    CREATE INDEX idx_api_call_operation ON api_call(service, operation, requested_at DESC);
    CREATE INDEX idx_api_call_blob ON api_call(response_blob_id);

    CREATE TABLE api_raw_item (
      raw_item_id INTEGER PRIMARY KEY,
      service TEXT NOT NULL,
      operation TEXT NOT NULL,
      item_sha256 TEXT NOT NULL CHECK (length(item_sha256) = 64),
      canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json) AND json_type(canonical_json) = 'object'),
      source_identity_json TEXT CHECK (source_identity_json IS NULL OR json_valid(source_identity_json)),
      parser_version TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      UNIQUE(service, operation, item_sha256)
    ) STRICT;
    CREATE UNIQUE INDEX idx_raw_item_hash ON api_raw_item(service, operation, item_sha256);

    CREATE TABLE raw_item_observation (
      observation_id INTEGER PRIMARY KEY,
      call_id TEXT NOT NULL REFERENCES api_call(call_id) ON DELETE CASCADE,
      raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      page_no INTEGER NOT NULL CHECK (page_no >= 1),
      item_ordinal INTEGER NOT NULL CHECK (item_ordinal >= 0),
      observed_at TEXT NOT NULL,
      UNIQUE(call_id, page_no, item_ordinal)
    ) STRICT;
    CREATE INDEX idx_observation_call ON raw_item_observation(call_id, page_no, item_ordinal);
    CREATE INDEX idx_observation_raw_item ON raw_item_observation(raw_item_id, observed_at DESC);
  `,
}, {
  version: 2,
  name: "phase3d_bid_notice_normalization",
  sql: `
    CREATE TABLE bid_notice (
      bid_notice_id INTEGER PRIMARY KEY,
      bid_ntce_no TEXT NOT NULL,
      bid_ntce_ord TEXT NOT NULL,
      bid_ntce_name TEXT,
      notice_kind_name TEXT,
      registration_type_name TEXT,
      reference_no TEXT,
      notice_institution_code TEXT,
      notice_institution_name TEXT,
      demand_institution_code TEXT,
      demand_institution_name TEXT,
      contract_method_name TEXT,
      bid_method_name TEXT,
      award_method_code TEXT,
      award_method_name TEXT,
      notice_posted_raw TEXT,
      notice_posted_local TEXT,
      bid_begin_raw TEXT,
      bid_begin_local TEXT,
      bid_close_raw TEXT,
      bid_close_local TEXT,
      opening_raw TEXT,
      opening_local TEXT,
      registered_raw TEXT,
      registered_local TEXT,
      changed_raw TEXT,
      changed_local TEXT,
      detailed_product_class_no TEXT,
      detailed_product_class_name TEXT,
      product_quantity TEXT,
      product_unit TEXT,
      product_unit_price INTEGER,
      product_specification TEXT,
      purchase_product_list_raw TEXT,
      allocated_budget_amount INTEGER,
      estimated_price INTEGER,
      vat_amount INTEGER,
      industry_vat_amount INTEGER,
      international_bid_yn TEXT,
      re_notice_yn TEXT,
      rebid_permitted_yn TEXT,
      manufacture_yn TEXT,
      designated_competition_yn TEXT,
      product_class_limit_yn TEXT,
      notice_url TEXT,
      notice_detail_url TEXT,
      standard_notice_document_url TEXT,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      source_operation TEXT NOT NULL,
      semantic_row_hash TEXT NOT NULL CHECK (length(semantic_row_hash) = 64),
      semantic_state_json TEXT NOT NULL CHECK (json_valid(semantic_state_json) AND json_type(semantic_state_json) = 'object'),
      parse_warnings_json TEXT NOT NULL CHECK (json_valid(parse_warnings_json) AND json_type(parse_warnings_json) = 'array'),
      first_normalized_at TEXT NOT NULL,
      last_normalized_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no, bid_ntce_ord)
    ) STRICT;
    CREATE INDEX idx_bid_notice_posted ON bid_notice(notice_posted_local);
    CREATE INDEX idx_bid_notice_close ON bid_notice(bid_close_local);
    CREATE INDEX idx_bid_notice_opening ON bid_notice(opening_local);
    CREATE INDEX idx_bid_notice_notice_inst ON bid_notice(notice_institution_code);
    CREATE INDEX idx_bid_notice_demand_inst ON bid_notice(demand_institution_code);
    CREATE INDEX idx_bid_notice_product_class ON bid_notice(detailed_product_class_no);
    CREATE INDEX idx_bid_notice_name ON bid_notice(bid_ntce_name);
    CREATE INDEX idx_bid_notice_source_raw ON bid_notice(source_raw_item_id);

    CREATE TABLE bid_notice_revision (
      bid_notice_revision_id INTEGER PRIMARY KEY,
      bid_notice_id INTEGER NOT NULL REFERENCES bid_notice(bid_notice_id) ON DELETE CASCADE,
      changed_at TEXT NOT NULL,
      previous_row_hash TEXT NOT NULL CHECK (length(previous_row_hash) = 64),
      new_row_hash TEXT NOT NULL CHECK (length(new_row_hash) = 64),
      previous_source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      new_source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      previous_state_json TEXT NOT NULL CHECK (json_valid(previous_state_json) AND json_type(previous_state_json) = 'object'),
      new_state_json TEXT NOT NULL CHECK (json_valid(new_state_json) AND json_type(new_state_json) = 'object')
    ) STRICT;
    CREATE INDEX idx_bid_notice_revision_notice ON bid_notice_revision(bid_notice_id, changed_at DESC);
    CREATE INDEX idx_bid_notice_revision_old_raw ON bid_notice_revision(previous_source_raw_item_id);
    CREATE INDEX idx_bid_notice_revision_new_raw ON bid_notice_revision(new_source_raw_item_id);
  `,
}, {
  version: 3,
  name: "phase3e_bid_item_basis_amount_normalization",
  sql: `
    CREATE TABLE bid_item (
      bid_item_id INTEGER PRIMARY KEY,
      bid_notice_id INTEGER NOT NULL REFERENCES bid_notice(bid_notice_id) ON DELETE CASCADE,
      bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT NOT NULL, bid_clsfc_no TEXT NOT NULL, product_seq TEXT NOT NULL,
      demand_institution_code TEXT, demand_institution_name TEXT,
      product_class_no TEXT, product_class_name TEXT, detailed_product_class_no TEXT, detailed_product_class_name TEXT,
      product_specification TEXT, quantity TEXT, unit TEXT, unit_price INTEGER,
      delivery_deadline_raw TEXT, delivery_deadline_local TEXT, delivery_day_count TEXT,
      delivery_place TEXT, delivery_condition_name TEXT, notice_posted_raw TEXT, notice_posted_local TEXT,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id), source_operation TEXT NOT NULL,
      semantic_row_hash TEXT NOT NULL CHECK(length(semantic_row_hash)=64),
      semantic_state_json TEXT NOT NULL CHECK(json_valid(semantic_state_json) AND json_type(semantic_state_json)='object'),
      parse_warnings_json TEXT NOT NULL CHECK(json_valid(parse_warnings_json) AND json_type(parse_warnings_json)='array'),
      first_normalized_at TEXT NOT NULL, last_normalized_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,product_seq)
    ) STRICT;
    CREATE INDEX idx_bid_item_notice ON bid_item(bid_notice_id);
    CREATE INDEX idx_bid_item_product_class ON bid_item(product_class_no);
    CREATE INDEX idx_bid_item_detail_class ON bid_item(detailed_product_class_no);
    CREATE INDEX idx_bid_item_demand_inst ON bid_item(demand_institution_code);
    CREATE INDEX idx_bid_item_source_raw ON bid_item(source_raw_item_id);

    CREATE TABLE bid_item_revision (
      bid_item_revision_id INTEGER PRIMARY KEY,
      bid_item_id INTEGER NOT NULL REFERENCES bid_item(bid_item_id) ON DELETE CASCADE,
      changed_at TEXT NOT NULL, previous_row_hash TEXT NOT NULL CHECK(length(previous_row_hash)=64),
      new_row_hash TEXT NOT NULL CHECK(length(new_row_hash)=64),
      previous_source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      new_source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      previous_state_json TEXT NOT NULL CHECK(json_valid(previous_state_json)),
      new_state_json TEXT NOT NULL CHECK(json_valid(new_state_json))
    ) STRICT;
    CREATE INDEX idx_bid_item_revision_item ON bid_item_revision(bid_item_id,changed_at DESC);

    CREATE TABLE bid_basis_amount (
      bid_basis_amount_id INTEGER PRIMARY KEY,
      bid_notice_id INTEGER NOT NULL REFERENCES bid_notice(bid_notice_id) ON DELETE CASCADE,
      bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT NOT NULL, bid_clsfc_no TEXT NOT NULL, bid_ntce_name TEXT,
      basis_amount INTEGER, basis_amount_open_raw TEXT, basis_amount_open_local TEXT,
      reserve_price_range_begin_rate TEXT, reserve_price_range_end_rate TEXT,
      evaluation_basis_amount INTEGER, difficulty_coefficient TEXT, other_general_expense_basis_rate TEXT,
      general_management_cost_basis_rate TEXT, profit_basis_rate TEXT, labor_cost_basis_rate TEXT,
      industrial_safety_health_management_cost INTEGER, retirement_mutual_aid INTEGER,
      environmental_conservation_cost INTEGER, subcontract_payment_guarantee_fee INTEGER,
      health_insurance_premium INTEGER, national_pension_premium INTEGER,
      remark1 TEXT, remark2 TEXT, useful_amount INTEGER, input_raw TEXT, input_local TEXT,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id), source_operation TEXT NOT NULL,
      semantic_row_hash TEXT NOT NULL CHECK(length(semantic_row_hash)=64),
      semantic_state_json TEXT NOT NULL CHECK(json_valid(semantic_state_json) AND json_type(semantic_state_json)='object'),
      parse_warnings_json TEXT NOT NULL CHECK(json_valid(parse_warnings_json) AND json_type(parse_warnings_json)='array'),
      first_normalized_at TEXT NOT NULL, last_normalized_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,bid_clsfc_no)
    ) STRICT;
    CREATE INDEX idx_bid_basis_notice ON bid_basis_amount(bid_notice_id);
    CREATE INDEX idx_bid_basis_open ON bid_basis_amount(basis_amount_open_local);
    CREATE INDEX idx_bid_basis_amount_value ON bid_basis_amount(basis_amount);
    CREATE INDEX idx_bid_basis_source_raw ON bid_basis_amount(source_raw_item_id);

    CREATE TABLE bid_basis_amount_revision (
      bid_basis_amount_revision_id INTEGER PRIMARY KEY,
      bid_basis_amount_id INTEGER NOT NULL REFERENCES bid_basis_amount(bid_basis_amount_id) ON DELETE CASCADE,
      changed_at TEXT NOT NULL, previous_row_hash TEXT NOT NULL CHECK(length(previous_row_hash)=64),
      new_row_hash TEXT NOT NULL CHECK(length(new_row_hash)=64),
      previous_source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      new_source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      previous_state_json TEXT NOT NULL CHECK(json_valid(previous_state_json)),
      new_state_json TEXT NOT NULL CHECK(json_valid(new_state_json))
    ) STRICT;
    CREATE INDEX idx_bid_basis_revision_basis ON bid_basis_amount_revision(bid_basis_amount_id,changed_at DESC);
  `,
}, {
  version: 4,
  name: "phase3f_manual_collector",
  sql: `
    ALTER TABLE collector_run ADD COLUMN inserted_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_run ADD COLUMN unchanged_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_run ADD COLUMN updated_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_run ADD COLUMN deferred_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_run ADD COLUMN normalization_error_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_run ADD COLUMN effective_range_start TEXT;
    ALTER TABLE collector_run ADD COLUMN effective_range_end TEXT;
    ALTER TABLE collector_run ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE collector_operation_run ADD COLUMN inserted_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_operation_run ADD COLUMN unchanged_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_operation_run ADD COLUMN updated_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_operation_run ADD COLUMN deferred_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_operation_run ADD COLUMN normalization_error_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_operation_run ADD COLUMN overlap_minutes INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collector_operation_run ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE collector_checkpoint (
      checkpoint_id INTEGER PRIMARY KEY,
      service TEXT NOT NULL,
      operation TEXT NOT NULL,
      query_basis TEXT NOT NULL,
      successful_through TEXT NOT NULL,
      last_run_id TEXT NOT NULL REFERENCES collector_run(run_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(service,operation,query_basis)
    ) STRICT;
    CREATE INDEX idx_checkpoint_boundary ON collector_checkpoint(successful_through);

    CREATE TABLE collector_work_item (
      work_item_id INTEGER PRIMARY KEY,
      created_run_id TEXT NOT NULL REFERENCES collector_run(run_id),
      last_attempt_run_id TEXT REFERENCES collector_run(run_id),
      operation TEXT NOT NULL CHECK(operation IN ('getBidPblancListInfoThngPurchsObjPrdct','getBidPblancListInfoThngBsisAmount')),
      bid_ntce_no TEXT NOT NULL,
      bid_ntce_ord TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      last_error_category TEXT,
      last_error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(created_run_id,operation,bid_ntce_no,bid_ntce_ord)
    ) STRICT;
    CREATE INDEX idx_work_item_retry ON collector_work_item(status,operation,created_at);
    CREATE INDEX idx_work_item_identity ON collector_work_item(operation,bid_ntce_no,bid_ntce_ord);
  `,
}, {
  version: 5,
  name: "phase3g1_historical_backfill_operational_state",
  sql: `
    CREATE TABLE historical_backfill_job (
      job_id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      query_basis TEXT NOT NULL,
      start_boundary TEXT NOT NULL,
      cutoff_boundary TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction='forward'),
      chunk_minutes INTEGER NOT NULL CHECK(chunk_minutes>0),
      status TEXT NOT NULL CHECK(status IN ('planned','running','paused','completed','completed_with_errors','failed','cancelled')),
      successful_through TEXT,
      stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1)),
      created_at TEXT NOT NULL,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      last_run_id TEXT REFERENCES collector_run(run_id),
      error_summary TEXT,
      CHECK(start_boundary < cutoff_boundary),
      CHECK(successful_through IS NULL OR (successful_through >= start_boundary AND successful_through <= cutoff_boundary))
    ) STRICT;
    CREATE INDEX idx_historical_job_active ON historical_backfill_job(status,created_at);

    CREATE TABLE historical_backfill_chunk (
      chunk_id INTEGER PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES historical_backfill_job(job_id) ON DELETE RESTRICT,
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      started_at TEXT,
      completed_at TEXT,
      last_run_id TEXT REFERENCES collector_run(run_id),
      error_category TEXT,
      error_summary TEXT,
      CHECK(range_start <= range_end),
      UNIQUE(job_id,range_start,range_end)
    ) STRICT;
    CREATE INDEX idx_historical_chunk_resume ON historical_backfill_chunk(job_id,status,range_start);

    CREATE TABLE collector_lease (
      lease_name TEXT PRIMARY KEY CHECK(lease_name='market-collector'),
      holder_token TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('manual','historical')),
      job_id TEXT REFERENCES historical_backfill_job(job_id),
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      CHECK((mode='historical' AND job_id IS NOT NULL) OR (mode='manual' AND job_id IS NULL))
    ) STRICT;
  `,
}, {
  version: 6,
  name: "initial_monthly_target_state",
  sql: `
    CREATE TABLE initial_collection_job (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('running','paused','completed')),
      cutoff_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;
    CREATE TABLE initial_collection_target (
      job_id TEXT NOT NULL REFERENCES initial_collection_job(job_id) ON DELETE RESTRICT,
      dtil_prdct_clsfc_no TEXT NOT NULL CHECK(length(dtil_prdct_clsfc_no)=10),
      target_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','paused','completed')),
      successful_through_month TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(job_id,dtil_prdct_clsfc_no)
    ) STRICT;
    CREATE TABLE initial_month_probe (
      job_id TEXT NOT NULL,
      dtil_prdct_clsfc_no TEXT NOT NULL,
      month TEXT NOT NULL CHECK(length(month)=7),
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      total_count INTEGER NOT NULL CHECK(total_count>=0),
      status TEXT NOT NULL CHECK(status IN ('probed','collecting','collected')),
      probed_at TEXT NOT NULL,
      completed_at TEXT,
      last_run_id TEXT REFERENCES collector_run(run_id),
      PRIMARY KEY(job_id,dtil_prdct_clsfc_no,month),
      FOREIGN KEY(job_id,dtil_prdct_clsfc_no) REFERENCES initial_collection_target(job_id,dtil_prdct_clsfc_no) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX idx_initial_resume ON initial_collection_target(job_id,status,dtil_prdct_clsfc_no);
  `,
}, {
  version: 7,
  name: "initial_month_partial_status",
  sql: `
    CREATE TABLE initial_month_probe_v7 (
      job_id TEXT NOT NULL,
      dtil_prdct_clsfc_no TEXT NOT NULL,
      month TEXT NOT NULL CHECK(length(month)=7),
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      total_count INTEGER NOT NULL CHECK(total_count>=0),
      status TEXT NOT NULL CHECK(status IN ('probed','collecting','collected','partial')),
      probed_at TEXT NOT NULL,
      completed_at TEXT,
      last_run_id TEXT REFERENCES collector_run(run_id),
      PRIMARY KEY(job_id,dtil_prdct_clsfc_no,month),
      FOREIGN KEY(job_id,dtil_prdct_clsfc_no) REFERENCES initial_collection_target(job_id,dtil_prdct_clsfc_no) ON DELETE RESTRICT
    ) STRICT;
    INSERT INTO initial_month_probe_v7 SELECT * FROM initial_month_probe;
    DROP TABLE initial_month_probe;
    ALTER TABLE initial_month_probe_v7 RENAME TO initial_month_probe;
  `,
}, {
  version: 8,
  name: "award_collection_foundation",
  sql: `
    CREATE TABLE award_result (
      award_result_id INTEGER PRIMARY KEY,
      bid_notice_id INTEGER REFERENCES bid_notice(bid_notice_id),
      target_detailed_product_class_no TEXT NOT NULL CHECK(length(target_detailed_product_class_no)=10),
      bid_ntce_no TEXT NOT NULL,
      bid_ntce_ord TEXT NOT NULL,
      bid_clsfc_no TEXT NOT NULL,
      rbid_no TEXT NOT NULL,
      notice_division_code TEXT,
      bid_ntce_name TEXT,
      participant_count INTEGER,
      winner_name TEXT NOT NULL,
      winner_business_no TEXT NOT NULL,
      winner_ceo_name TEXT,
      winner_address TEXT,
      winner_tel_no TEXT,
      successful_bid_amount INTEGER,
      successful_bid_rate TEXT,
      real_opening_raw TEXT,
      real_opening_local TEXT,
      demand_institution_code TEXT,
      demand_institution_name TEXT,
      registered_raw TEXT NOT NULL,
      registered_local TEXT,
      final_successful_date TEXT,
      winner_official TEXT,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      source_operation TEXT NOT NULL,
      semantic_row_hash TEXT NOT NULL CHECK(length(semantic_row_hash)=64),
      semantic_state_json TEXT NOT NULL CHECK(json_valid(semantic_state_json) AND json_type(semantic_state_json)='object'),
      parse_warnings_json TEXT NOT NULL CHECK(json_valid(parse_warnings_json) AND json_type(parse_warnings_json)='array'),
      first_normalized_at TEXT NOT NULL,
      last_normalized_at TEXT NOT NULL,
      UNIQUE(target_detailed_product_class_no,bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no)
    ) STRICT;
    CREATE INDEX idx_award_notice_key ON award_result(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no);
    CREATE INDEX idx_award_notice_fk ON award_result(bid_notice_id);
    CREATE INDEX idx_award_target_date ON award_result(target_detailed_product_class_no,real_opening_local);
    CREATE INDEX idx_award_winner_business ON award_result(winner_business_no);

    CREATE TABLE award_result_revision (
      award_result_revision_id INTEGER PRIMARY KEY,
      award_result_id INTEGER NOT NULL REFERENCES award_result(award_result_id) ON DELETE CASCADE,
      changed_at TEXT NOT NULL,
      previous_row_hash TEXT NOT NULL CHECK(length(previous_row_hash)=64),
      new_row_hash TEXT NOT NULL CHECK(length(new_row_hash)=64),
      previous_source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      new_source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      previous_state_json TEXT NOT NULL CHECK(json_valid(previous_state_json)),
      new_state_json TEXT NOT NULL CHECK(json_valid(new_state_json))
    ) STRICT;

    CREATE TABLE award_collection_job (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('running','paused','completed')),
      cutoff_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;
    CREATE TABLE award_collection_target (
      job_id TEXT NOT NULL REFERENCES award_collection_job(job_id) ON DELETE RESTRICT,
      dtil_prdct_clsfc_no TEXT NOT NULL CHECK(length(dtil_prdct_clsfc_no)=10),
      target_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','paused','completed')),
      successful_through_month TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(job_id,dtil_prdct_clsfc_no)
    ) STRICT;
    CREATE TABLE award_month_probe (
      job_id TEXT NOT NULL,
      dtil_prdct_clsfc_no TEXT NOT NULL,
      month TEXT NOT NULL CHECK(length(month)=7),
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      total_count INTEGER NOT NULL CHECK(total_count>=0),
      status TEXT NOT NULL CHECK(status IN ('probed','collecting','collected','partial')),
      probed_at TEXT NOT NULL,
      completed_at TEXT,
      last_run_id TEXT REFERENCES collector_run(run_id),
      PRIMARY KEY(job_id,dtil_prdct_clsfc_no,month),
      FOREIGN KEY(job_id,dtil_prdct_clsfc_no) REFERENCES award_collection_target(job_id,dtil_prdct_clsfc_no) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX idx_award_resume ON award_collection_target(job_id,status,dtil_prdct_clsfc_no);
  `,
}, {
  version: 9,
  name: "contract_collection_foundation",
  sql: `
    CREATE TABLE contract_result (
      contract_result_id INTEGER PRIMARY KEY,
      target_detailed_product_class_no TEXT NOT NULL CHECK(length(target_detailed_product_class_no)=10),
      decision_contract_no TEXT NOT NULL,
      contract_no TEXT,
      contract_name TEXT,
      contract_method_name TEXT,
      contract_institution_name TEXT,
      demand_institution_name TEXT,
      contract_amount INTEGER,
      contract_date TEXT,
      contract_detail_url TEXT,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      source_operation TEXT NOT NULL,
      semantic_row_hash TEXT NOT NULL CHECK(length(semantic_row_hash)=64),
      semantic_state_json TEXT NOT NULL CHECK(json_valid(semantic_state_json) AND json_type(semantic_state_json)='object'),
      parse_warnings_json TEXT NOT NULL CHECK(json_valid(parse_warnings_json) AND json_type(parse_warnings_json)='array'),
      first_normalized_at TEXT NOT NULL,
      last_normalized_at TEXT NOT NULL,
      UNIQUE(target_detailed_product_class_no,decision_contract_no)
    ) STRICT;
    CREATE INDEX idx_contract_target_date ON contract_result(target_detailed_product_class_no,contract_date);

    CREATE TABLE contract_collection_job (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('running','paused','completed')),
      cutoff_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;
    CREATE TABLE contract_collection_target (
      job_id TEXT NOT NULL REFERENCES contract_collection_job(job_id) ON DELETE RESTRICT,
      dtil_prdct_clsfc_no TEXT NOT NULL CHECK(length(dtil_prdct_clsfc_no)=10),
      target_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','paused','completed')),
      successful_through_month TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(job_id,dtil_prdct_clsfc_no)
    ) STRICT;
    CREATE TABLE contract_month_probe (
      job_id TEXT NOT NULL,
      dtil_prdct_clsfc_no TEXT NOT NULL,
      month TEXT NOT NULL CHECK(length(month)=7),
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      total_count INTEGER NOT NULL CHECK(total_count>=0),
      status TEXT NOT NULL CHECK(status IN ('probed','collecting','collected','partial')),
      probed_at TEXT NOT NULL,
      completed_at TEXT,
      last_run_id TEXT REFERENCES collector_run(run_id),
      PRIMARY KEY(job_id,dtil_prdct_clsfc_no,month),
      FOREIGN KEY(job_id,dtil_prdct_clsfc_no) REFERENCES contract_collection_target(job_id,dtil_prdct_clsfc_no) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX idx_contract_resume ON contract_collection_target(job_id,status,dtil_prdct_clsfc_no);
  `,
}];
