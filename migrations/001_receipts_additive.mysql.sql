-- Additive receipt scanner tables for an existing invoice/accounting database.
-- Review the production schema before running this migration.
-- This migration intentionally does not drop, rename, or alter existing invoice tables.

CREATE TABLE IF NOT EXISTS receipts (
  id VARCHAR(36) PRIMARY KEY,
  status VARCHAR(32) NOT NULL,
  merchant_display_name VARCHAR(255) NULL,
  receipt_date VARCHAR(32) NULL,
  receipt_time VARCHAR(32) NULL,
  currency VARCHAR(8) NULL,
  grand_total_cents INT NULL,
  grand_total_raw VARCHAR(64) NULL,
  extraction_json JSON NULL,
  validation_json JSON NULL,
  image_quality_json JSON NULL,
  duplicate_hash VARCHAR(128) NULL,
  failure_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_receipts_status (status),
  INDEX idx_receipts_duplicate_hash (duplicate_hash),
  INDEX idx_receipts_date (receipt_date),
  INDEX idx_receipts_merchant (merchant_display_name)
);

CREATE TABLE IF NOT EXISTS receipt_files (
  id VARCHAR(36) PRIMARY KEY,
  receipt_id VARCHAR(36) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  byte_size INT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  width INT NULL,
  height INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receipt_files_receipt_id (receipt_id),
  INDEX idx_receipt_files_sha256 (sha256),
  UNIQUE KEY uq_receipt_file_sha_kind (receipt_id, kind, sha256),
  CONSTRAINT fk_receipt_files_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS receipt_line_items (
  id VARCHAR(36) PRIMARY KEY,
  receipt_id VARCHAR(36) NOT NULL,
  line_index INT NOT NULL,
  raw_line_text TEXT NOT NULL,
  item_name VARCHAR(512) NULL,
  normalized_name VARCHAR(512) NULL,
  quantity_raw VARCHAR(64) NULL,
  unit VARCHAR(64) NULL,
  unit_price_raw VARCHAR(64) NULL,
  unit_price_cents INT NULL,
  discount_amount_raw VARCHAR(64) NULL,
  discount_amount_cents INT NULL,
  discount_percent VARCHAR(64) NULL,
  vat_rate VARCHAR(32) NULL,
  line_total_raw VARCHAR(64) NULL,
  line_total_cents INT NULL,
  item_code_barcode VARCHAR(128) NULL,
  category VARCHAR(128) NULL,
  confidence_json JSON NULL,
  warnings_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receipt_line_items_receipt_id (receipt_id),
  CONSTRAINT fk_receipt_line_items_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS receipt_vat_breakdown (
  id VARCHAR(36) PRIMARY KEY,
  receipt_id VARCHAR(36) NOT NULL,
  vat_rate VARCHAR(32) NULL,
  taxable_amount_raw VARCHAR(64) NULL,
  taxable_amount_cents INT NULL,
  vat_amount_raw VARCHAR(64) NULL,
  vat_amount_cents INT NULL,
  gross_amount_raw VARCHAR(64) NULL,
  gross_amount_cents INT NULL,
  raw_text TEXT NULL,
  confidence DECIMAL(5,4) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receipt_vat_receipt_id (receipt_id),
  CONSTRAINT fk_receipt_vat_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS receipt_validation_results (
  id VARCHAR(36) PRIMARY KEY,
  receipt_id VARCHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL,
  can_verify BOOLEAN NOT NULL,
  issues_json JSON NOT NULL,
  checks_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receipt_validation_receipt_id (receipt_id),
  CONSTRAINT fk_receipt_validation_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS receipt_extraction_raw (
  id VARCHAR(36) PRIMARY KEY,
  receipt_id VARCHAR(36) NOT NULL,
  provider VARCHAR(64) NULL,
  model VARCHAR(128) NULL,
  extraction_json JSON NOT NULL,
  raw_response_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receipt_extraction_receipt_id (receipt_id),
  CONSTRAINT fk_receipt_extraction_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS receipt_audit_log (
  id VARCHAR(36) PRIMARY KEY,
  receipt_id VARCHAR(36) NOT NULL,
  action VARCHAR(128) NOT NULL,
  actor VARCHAR(128) NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receipt_audit_receipt_id (receipt_id),
  CONSTRAINT fk_receipt_audit_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);
