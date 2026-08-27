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
}, {
  version: 10,
  name: "detailed_product_category",
  sql: `
    CREATE TABLE detailed_product_category (
      detailed_product_class_no TEXT NOT NULL CHECK(length(detailed_product_class_no)=10),
      category TEXT CHECK(category IN ('product','part')),
      source TEXT NOT NULL CHECK(source IN ('catalog_item_cmpnt_yn','catalog_class_consensus','manual_override','unknown')),
      evidence_note TEXT NOT NULL,
      valid_item_count INTEGER CHECK(valid_item_count IS NULL OR valid_item_count>=0),
      component_yes_count INTEGER CHECK(component_yes_count IS NULL OR component_yes_count>=0),
      component_no_count INTEGER CHECK(component_no_count IS NULL OR component_no_count>=0),
      indeterminate_count INTEGER CHECK(indeterminate_count IS NULL OR indeterminate_count>=0),
      observed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(detailed_product_class_no,source),
      CHECK((source='unknown' AND category IS NULL) OR (source!='unknown' AND category IS NOT NULL)),
      CHECK(source!='catalog_class_consensus' OR (
        valid_item_count>0 AND indeterminate_count=0 AND
        ((category='part' AND component_yes_count=valid_item_count AND component_no_count=0) OR
         (category='product' AND component_no_count=valid_item_count AND component_yes_count=0))
      ))
    ) STRICT;
    CREATE INDEX idx_detailed_product_category_category
      ON detailed_product_category(category,detailed_product_class_no);
  `,
}, {
  version: 11,
  name: "catalog_item_category",
  sql: `
    CREATE TABLE catalog_item_category (
      prdct_idnt_no TEXT PRIMARY KEY CHECK(length(prdct_idnt_no)=8),
      detailed_product_class_no TEXT NOT NULL CHECK(length(detailed_product_class_no)=10),
      category TEXT NOT NULL CHECK(category IN ('product','part')),
      cmpnt_yn TEXT NOT NULL CHECK(cmpnt_yn IN ('Y','N')),
      use_yn TEXT CHECK(use_yn IN ('Y','N')),
      dlt_yn TEXT CHECK(dlt_yn IN ('Y','N')),
      evidence_note TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK((cmpnt_yn='Y' AND category='part') OR (cmpnt_yn='N' AND category='product'))
    ) STRICT;
    CREATE INDEX idx_catalog_item_category_lookup ON catalog_item_category(category,prdct_idnt_no);
    CREATE INDEX idx_catalog_item_detailed_class ON catalog_item_category(detailed_product_class_no,prdct_idnt_no);
  `,
}, {
  version: 12,
  name: "award_catalog_item_link",
  sql: `
    CREATE TABLE award_catalog_item_link (
      award_result_id INTEGER NOT NULL REFERENCES award_result(award_result_id) ON DELETE RESTRICT,
      prdct_idnt_no TEXT NOT NULL REFERENCES catalog_item_category(prdct_idnt_no) ON DELETE RESTRICT,
      source TEXT NOT NULL CHECK(source IN ('official_api','manual_verified')),
      evidence_note TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(award_result_id,prdct_idnt_no)
    ) STRICT;
    CREATE INDEX idx_award_catalog_item_link_item
      ON award_catalog_item_link(prdct_idnt_no,award_result_id);
  `,
}, {
  version: 13,
  name: "official_lifecycle_enrichment",
  sql: `
    CREATE TABLE lifecycle_collection_state (
      bid_notice_id INTEGER PRIMARY KEY REFERENCES bid_notice(bid_notice_id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      last_attempt_at TEXT, collected_at TEXT, last_error_category TEXT, last_error_summary TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX idx_lifecycle_state_retry ON lifecycle_collection_state(status,updated_at);

    CREATE TABLE lifecycle_record (
      lifecycle_record_id INTEGER PRIMARY KEY,
      bid_notice_id INTEGER NOT NULL REFERENCES bid_notice(bid_notice_id) ON DELETE RESTRICT,
      order_plan_no TEXT, order_plan_unified_no TEXT, prior_specification_registration_no TEXT,
      bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT, procurement_request_no TEXT, bid_ntce_name TEXT,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id),
      source_operation TEXT NOT NULL CHECK(source_operation='getCntrctProcssIntgOpenThng'),
      collected_at TEXT NOT NULL,
      UNIQUE(bid_notice_id)
    ) STRICT;
    CREATE INDEX idx_lifecycle_notice_key ON lifecycle_record(bid_ntce_no,bid_ntce_ord);

    CREATE TABLE lifecycle_award (
      lifecycle_award_id INTEGER PRIMARY KEY,
      lifecycle_record_id INTEGER NOT NULL REFERENCES lifecycle_record(lifecycle_record_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0), winner_name TEXT, winner_business_no TEXT, winner_ceo_name TEXT,
      successful_bid_amount INTEGER, successful_bid_rate TEXT, participant_count INTEGER, opening_datetime TEXT,
      raw_json TEXT NOT NULL CHECK(json_valid(raw_json) AND json_type(raw_json)='object'),
      UNIQUE(lifecycle_record_id,ordinal)
    ) STRICT;
    CREATE TABLE lifecycle_contract (
      lifecycle_contract_id INTEGER PRIMARY KEY,
      lifecycle_record_id INTEGER NOT NULL REFERENCES lifecycle_record(lifecycle_record_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0), contract_no TEXT, contract_name TEXT,
      contract_institution_name TEXT, contract_method_name TEXT, contract_amount INTEGER, contract_date TEXT,
      raw_json TEXT NOT NULL CHECK(json_valid(raw_json) AND json_type(raw_json)='object'),
      UNIQUE(lifecycle_record_id,ordinal)
    ) STRICT;

    CREATE TABLE bid_award_link (
      bid_notice_id INTEGER NOT NULL REFERENCES bid_notice(bid_notice_id) ON DELETE RESTRICT,
      lifecycle_award_id INTEGER NOT NULL REFERENCES lifecycle_award(lifecycle_award_id) ON DELETE CASCADE,
      award_result_id INTEGER REFERENCES award_result(award_result_id) ON DELETE RESTRICT,
      relationship_source TEXT NOT NULL CHECK(relationship_source IN ('official_integrated_api','candidate','manual_verified')),
      match_status TEXT NOT NULL CHECK(match_status IN ('official_unmatched','official_matched','candidate','manual_verified')),
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(bid_notice_id,lifecycle_award_id)
    ) STRICT;
    CREATE TABLE bid_contract_link (
      bid_notice_id INTEGER NOT NULL REFERENCES bid_notice(bid_notice_id) ON DELETE RESTRICT,
      lifecycle_contract_id INTEGER NOT NULL REFERENCES lifecycle_contract(lifecycle_contract_id) ON DELETE CASCADE,
      contract_result_id INTEGER REFERENCES contract_result(contract_result_id) ON DELETE RESTRICT,
      relationship_source TEXT NOT NULL CHECK(relationship_source IN ('official_integrated_api','candidate','manual_verified')),
      match_status TEXT NOT NULL CHECK(match_status IN ('official_unmatched','official_matched','candidate','manual_verified')),
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(bid_notice_id,lifecycle_contract_id)
    ) STRICT;
    CREATE TABLE lifecycle_group_member (
      lifecycle_record_id INTEGER NOT NULL REFERENCES lifecycle_record(lifecycle_record_id) ON DELETE CASCADE,
      member_kind TEXT NOT NULL CHECK(member_kind IN ('award','contract')), member_id INTEGER NOT NULL,
      relationship_source TEXT NOT NULL CHECK(relationship_source='official_integrated_api'),
      PRIMARY KEY(lifecycle_record_id,member_kind,member_id)
    ) STRICT;
  `,
}, {
  version: 14,
  name: "lifecycle_collection_outcomes",
  sql: `
    ALTER TABLE lifecycle_collection_state RENAME TO lifecycle_collection_state_v13;
    CREATE TABLE lifecycle_collection_state (
      bid_notice_id INTEGER PRIMARY KEY REFERENCES bid_notice(bid_notice_id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCESS','NO_DATA','FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      last_attempt_at TEXT, collected_at TEXT, last_call_id TEXT REFERENCES api_call(call_id),
      last_error_category TEXT, last_error_summary TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO lifecycle_collection_state
      (bid_notice_id,status,attempts,last_attempt_at,collected_at,last_error_category,last_error_summary,updated_at)
    SELECT bid_notice_id,
      CASE status WHEN 'succeeded' THEN 'SUCCESS' WHEN 'failed' THEN 'FAILED'
        WHEN 'running' THEN 'FAILED' ELSE 'PENDING' END,
      attempts,last_attempt_at,collected_at,last_error_category,last_error_summary,updated_at
    FROM lifecycle_collection_state_v13;
    DROP TABLE lifecycle_collection_state_v13;
    CREATE INDEX idx_lifecycle_state_retry ON lifecycle_collection_state(status,updated_at);
    CREATE INDEX idx_contract_decision_no ON contract_result(decision_contract_no);
  `,
}, {
  version: 15,
  name: "source_derived_contract_items",
  sql: `
    -- contract_result is intentionally retained as legacy orchestration-derived data.
    CREATE TABLE contract_header (
      contract_header_id INTEGER PRIMARY KEY,
      unty_cntrct_no TEXT NOT NULL UNIQUE,
      decision_contract_no TEXT,
      contract_ref_no TEXT,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,
      source_operation TEXT NOT NULL CHECK(source_operation='getCntrctInfoListThngPPSSrch'),
      raw_json TEXT NOT NULL CHECK(json_valid(raw_json) AND json_type(raw_json)='object'),
      first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE contract_detail_state (
      contract_header_id INTEGER PRIMARY KEY REFERENCES contract_header(contract_header_id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCESS','FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      last_attempt_at TEXT, completed_at TEXT, last_error_summary TEXT, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX idx_contract_detail_resume ON contract_detail_state(status,updated_at);
    CREATE TABLE contract_item (
      contract_item_id INTEGER PRIMARY KEY,
      contract_header_id INTEGER NOT NULL REFERENCES contract_header(contract_header_id) ON DELETE RESTRICT,
      source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint)=64),
      unty_cntrct_no TEXT NOT NULL, decision_contract_no TEXT, contract_ref_no TEXT,
      product_class_no TEXT, product_identification_no TEXT, product_class_name TEXT, korean_product_name TEXT,
      quantity TEXT, unit_price_amount TEXT, product_amount TEXT,
      target_detailed_product_class_no TEXT CHECK(target_detailed_product_class_no IS NULL OR length(target_detailed_product_class_no)=10),
      resolution_status TEXT NOT NULL CHECK(resolution_status IN ('RESOLVED_TARGET','RESOLVED_NON_TARGET','UNRESOLVED')),
      resolution_reason TEXT NOT NULL,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,
      source_operation TEXT NOT NULL CHECK(source_operation='getCntrctInfoListThngDetail'),
      raw_json TEXT NOT NULL CHECK(json_valid(raw_json) AND json_type(raw_json)='object'),
      first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(contract_header_id,source_fingerprint)
    ) STRICT;
    CREATE INDEX idx_contract_item_target ON contract_item(target_detailed_product_class_no,contract_header_id);
    CREATE INDEX idx_contract_item_product_id ON contract_item(product_identification_no);
    CREATE TABLE contract_catalog_cache (
      product_identification_no TEXT PRIMARY KEY CHECK(length(product_identification_no)=8),
      detailed_product_class_no TEXT CHECK(detailed_product_class_no IS NULL OR length(detailed_product_class_no)=10),
      lookup_status TEXT NOT NULL CHECK(lookup_status IN ('FOUND','NOT_FOUND','FAILED')),
      source_raw_item_id INTEGER REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,
      last_error_summary TEXT, observed_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
  `,
}, {
  version: 16,
  name: "repair_source_derived_contract_items",
  sql: `
    CREATE TABLE IF NOT EXISTS contract_header (
      contract_header_id INTEGER PRIMARY KEY, unty_cntrct_no TEXT NOT NULL UNIQUE,
      decision_contract_no TEXT, contract_ref_no TEXT,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,
      source_operation TEXT NOT NULL CHECK(source_operation='getCntrctInfoListThngPPSSrch'),
      raw_json TEXT NOT NULL CHECK(json_valid(raw_json) AND json_type(raw_json)='object'),
      first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS contract_detail_state (
      contract_header_id INTEGER PRIMARY KEY REFERENCES contract_header(contract_header_id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCESS','FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      last_attempt_at TEXT, completed_at TEXT, last_error_summary TEXT, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_contract_detail_resume ON contract_detail_state(status,updated_at);
    CREATE TABLE IF NOT EXISTS contract_item (
      contract_item_id INTEGER PRIMARY KEY,
      contract_header_id INTEGER NOT NULL REFERENCES contract_header(contract_header_id) ON DELETE RESTRICT,
      source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint)=64),
      unty_cntrct_no TEXT NOT NULL, decision_contract_no TEXT, contract_ref_no TEXT,
      product_class_no TEXT, product_identification_no TEXT, product_class_name TEXT, korean_product_name TEXT,
      quantity TEXT, unit_price_amount TEXT, product_amount TEXT,
      target_detailed_product_class_no TEXT CHECK(target_detailed_product_class_no IS NULL OR length(target_detailed_product_class_no)=10),
      resolution_status TEXT NOT NULL CHECK(resolution_status IN ('RESOLVED_TARGET','RESOLVED_NON_TARGET','UNRESOLVED')),
      resolution_reason TEXT NOT NULL,
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,
      source_operation TEXT NOT NULL CHECK(source_operation='getCntrctInfoListThngDetail'),
      raw_json TEXT NOT NULL CHECK(json_valid(raw_json) AND json_type(raw_json)='object'),
      first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(contract_header_id,source_fingerprint)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_contract_item_target ON contract_item(target_detailed_product_class_no,contract_header_id);
    CREATE INDEX IF NOT EXISTS idx_contract_item_product_id ON contract_item(product_identification_no);
    CREATE TABLE IF NOT EXISTS contract_catalog_cache (
      product_identification_no TEXT PRIMARY KEY CHECK(length(product_identification_no)=8),
      detailed_product_class_no TEXT CHECK(detailed_product_class_no IS NULL OR length(detailed_product_class_no)=10),
      lookup_status TEXT NOT NULL CHECK(lookup_status IN ('FOUND','NOT_FOUND','FAILED')),
      source_raw_item_id INTEGER REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,
      last_error_summary TEXT, observed_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
  `,
}, {
  version: 17,
  name: "award_opening_enrichment",
  sql: `
    CREATE TABLE opening_enrichment_state (
      endpoint TEXT NOT NULL, bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT NOT NULL,
      bid_clsfc_no TEXT NOT NULL, rbid_no TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCESS','EMPTY','FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), last_error TEXT,
      last_attempt_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(endpoint,bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no)
    ) STRICT;
    CREATE INDEX idx_opening_enrichment_resume ON opening_enrichment_state(status,endpoint,updated_at);
    CREATE TABLE opening_participant (
      opening_participant_id INTEGER PRIMARY KEY,
      bid_ntce_no TEXT NOT NULL,bid_ntce_ord TEXT NOT NULL,bid_clsfc_no TEXT NOT NULL,rbid_no TEXT NOT NULL,
      opening_result_type_name TEXT,opening_rank TEXT,bidder_business_no TEXT,bidder_name TEXT,bidder_ceo_name TEXT,
      bid_amount INTEGER,bid_rate TEXT,remark TEXT,draw_no_1 TEXT,draw_no_2 TEXT,bid_datetime TEXT,
      item_fingerprint TEXT NOT NULL CHECK(length(item_fingerprint)=64),
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,observed_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no,item_fingerprint)
    ) STRICT;
    CREATE INDEX idx_opening_participant_identity ON opening_participant(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no);
    CREATE TABLE opening_preliminary_price (
      opening_preliminary_price_id INTEGER PRIMARY KEY,
      bid_ntce_no TEXT NOT NULL,bid_ntce_ord TEXT NOT NULL,bid_clsfc_no TEXT NOT NULL,rbid_no TEXT NOT NULL,
      planned_price INTEGER,basis_amount INTEGER,total_preliminary_price_count INTEGER,preliminary_price_sequence TEXT,
      preliminary_price INTEGER,selected_yn TEXT,selected_count INTEGER,actual_opening_datetime TEXT,
      upper_count_from_basis_amount INTEGER,preliminary_price_created_datetime TEXT,
      item_fingerprint TEXT NOT NULL CHECK(length(item_fingerprint)=64),
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,observed_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no,item_fingerprint)
    ) STRICT;
    CREATE INDEX idx_opening_preliminary_identity ON opening_preliminary_price(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no);
    CREATE TABLE opening_failure_event (
      opening_failure_event_id INTEGER PRIMARY KEY,
      bid_ntce_no TEXT NOT NULL,bid_ntce_ord TEXT NOT NULL,bid_clsfc_no TEXT NOT NULL,rbid_no TEXT NOT NULL,
      opening_result_type_name TEXT,failure_reason TEXT,
      item_fingerprint TEXT NOT NULL CHECK(length(item_fingerprint)=64),
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,observed_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no,item_fingerprint)
    ) STRICT;
    CREATE TABLE opening_rebid_event (
      opening_rebid_event_id INTEGER PRIMARY KEY,
      bid_ntce_no TEXT NOT NULL,bid_ntce_ord TEXT NOT NULL,bid_clsfc_no TEXT NOT NULL,rbid_no TEXT NOT NULL,
      opening_result_type_name TEXT,bid_deadline_datetime TEXT,opening_datetime TEXT,rebid_reason TEXT,
      consortium_agreement_deadline_datetime TEXT,
      item_fingerprint TEXT NOT NULL CHECK(length(item_fingerprint)=64),
      source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT,observed_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no,item_fingerprint)
    ) STRICT;
  `,
}, {
  version: 18,
  name: "bid_notice_enrichment",
  sql: `
    CREATE TABLE bid_enrichment_state (
      endpoint TEXT NOT NULL, bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCESS','EMPTY','FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), last_error TEXT,
      last_attempt_at TEXT, completed_at TEXT, last_checked_at TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(endpoint,bid_ntce_no,bid_ntce_ord),
      FOREIGN KEY(bid_ntce_no,bid_ntce_ord) REFERENCES bid_notice(bid_ntce_no,bid_ntce_ord) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX idx_bid_enrichment_resume ON bid_enrichment_state(status,endpoint,updated_at);
    CREATE INDEX idx_bid_enrichment_checked ON bid_enrichment_state(endpoint,last_checked_at);
    CREATE TABLE bid_license_limit (
      bid_license_limit_id INTEGER PRIMARY KEY, bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT NOT NULL,
      limit_group_no TEXT, limit_sequence TEXT, license_limit_name TEXT, allowed_industry_list TEXT, registered_at TEXT,
      item_fingerprint TEXT NOT NULL CHECK(length(item_fingerprint)=64), source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT, observed_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,item_fingerprint)
    ) STRICT;
    CREATE INDEX idx_bid_license_identity ON bid_license_limit(bid_ntce_no,bid_ntce_ord);
    CREATE TABLE bid_participation_region (
      bid_participation_region_id INTEGER PRIMARY KEY, bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT NOT NULL,
      limit_sequence TEXT, participation_region_name TEXT, registered_at TEXT,
      item_fingerprint TEXT NOT NULL CHECK(length(item_fingerprint)=64), source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT, observed_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,item_fingerprint)
    ) STRICT;
    CREATE INDEX idx_bid_region_identity ON bid_participation_region(bid_ntce_no,bid_ntce_ord);
    CREATE TABLE bid_notice_change_event (
      bid_notice_change_event_id INTEGER PRIMARY KEY, bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT NOT NULL,
      bid_clsfc_no TEXT, rbid_no TEXT, change_item_name TEXT, before_value TEXT, after_value TEXT, changed_at TEXT,
      source_identity_json TEXT NOT NULL CHECK(json_valid(source_identity_json) AND json_type(source_identity_json)='object'),
      item_fingerprint TEXT NOT NULL CHECK(length(item_fingerprint)=64), source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT, observed_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,item_fingerprint)
    ) STRICT;
    CREATE INDEX idx_bid_change_identity ON bid_notice_change_event(bid_ntce_no,bid_ntce_ord,changed_at);
    CREATE TABLE bid_eorder_attachment (
      bid_eorder_attachment_id INTEGER PRIMARY KEY, bid_ntce_no TEXT NOT NULL, bid_ntce_ord TEXT NOT NULL,
      attachment_sequence TEXT, document_type_name TEXT, file_name TEXT, file_url TEXT,
      item_fingerprint TEXT NOT NULL CHECK(length(item_fingerprint)=64), source_raw_item_id INTEGER NOT NULL REFERENCES api_raw_item(raw_item_id) ON DELETE RESTRICT, observed_at TEXT NOT NULL,
      UNIQUE(bid_ntce_no,bid_ntce_ord,item_fingerprint)
    ) STRICT;
    CREATE INDEX idx_bid_attachment_identity ON bid_eorder_attachment(bid_ntce_no,bid_ntce_ord);
  `,
}, {
  version: 19,
  name: "procurement_search_groups",
  sql: `
    CREATE TABLE procurement_group (
      procurement_group_id INTEGER PRIMARY KEY,
      representative_date TEXT, representative_title TEXT, demand_institution_name TEXT,
      detailed_product_class_no TEXT, detailed_product_class_name TEXT,
      item_category TEXT NOT NULL CHECK(item_category IN ('product','part','mixed','unknown')),
      representative_winner_name TEXT, representative_award_amount INTEGER, representative_award_rate TEXT,
      representative_contract_name TEXT, representative_contract_amount INTEGER,
      has_bid INTEGER NOT NULL CHECK(has_bid IN (0,1)), has_award INTEGER NOT NULL CHECK(has_award IN (0,1)), has_contract INTEGER NOT NULL CHECK(has_contract IN (0,1)),
      bid_count INTEGER NOT NULL CHECK(bid_count>=0), award_count INTEGER NOT NULL CHECK(award_count>=0), contract_count INTEGER NOT NULL CHECK(contract_count>=0),
      match_status TEXT NOT NULL CHECK(match_status IN ('EXACT','STRONG','UNLINKED')),
      rebuilt_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE procurement_group_member (
      procurement_group_id INTEGER NOT NULL REFERENCES procurement_group(procurement_group_id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('BID','AWARD','CONTRACT')),
      source_id INTEGER NOT NULL, member_role TEXT NOT NULL,
      match_method TEXT NOT NULL CHECK(match_method IN ('EXACT','STRONG','UNLINKED')),
      PRIMARY KEY(source_type,source_id)
    ) STRICT;
    CREATE INDEX idx_procurement_member_group ON procurement_group_member(procurement_group_id,source_type,source_id);
    CREATE INDEX idx_procurement_group_latest ON procurement_group(representative_date DESC,procurement_group_id DESC);
    CREATE INDEX idx_procurement_group_class_date ON procurement_group(detailed_product_class_no,representative_date DESC);
    CREATE INDEX idx_procurement_group_category_date ON procurement_group(item_category,representative_date DESC);
    CREATE INDEX idx_procurement_group_presence ON procurement_group(has_bid,has_award,has_contract,representative_date DESC);
    CREATE TABLE procurement_relation (
      procurement_relation_id INTEGER PRIMARY KEY,
      from_type TEXT NOT NULL CHECK(from_type IN ('BID','AWARD','CONTRACT')),
      from_id INTEGER NOT NULL, to_type TEXT NOT NULL CHECK(to_type IN ('BID','AWARD','CONTRACT')),
      to_id INTEGER NOT NULL, relation_type TEXT NOT NULL,
      match_method TEXT NOT NULL CHECK(match_method IN ('EXACT','STRONG')),
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), rebuilt_at TEXT NOT NULL,
      UNIQUE(from_type,from_id,to_type,to_id,relation_type)
    ) STRICT;
    CREATE INDEX idx_procurement_relation_from ON procurement_relation(from_type,from_id);
    CREATE INDEX idx_procurement_relation_to ON procurement_relation(to_type,to_id);
  `,
}];
