import mysql, { type Pool, type ResultSetHeader } from "mysql2/promise";
import { nanoid } from "nanoid";
import type { ReceiptAuditEntry, ReceiptFileRecord, ReceiptRecord, ReceiptStatus } from "../../shared/receiptTypes.js";
import { canTransitionReceiptStatus } from "../../shared/statusTransitions.js";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import type { ReceiptCreateInput, ReceiptPatchInput, ReceiptRepository } from "./receiptRepository.js";

type ReceiptRow = {
  id: string;
  status: ReceiptStatus;
  merchant_display_name: string | null;
  receipt_date: string | null;
  receipt_time: string | null;
  currency: string | null;
  grand_total_cents: number | null;
  grand_total_raw: string | null;
  extraction_json: string | null;
  validation_json: string | null;
  image_quality_json: string | null;
  duplicate_hash: string | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

export class MySqlReceiptRepository implements ReceiptRepository {
  readonly kind = "mysql" as const;
  private pool: Pool | null = null;

  async init(): Promise<void> {
    this.pool = config.databaseUrl
      ? mysql.createPool(config.databaseUrl)
      : mysql.createPool({
          host: config.db.host,
          port: config.db.port,
          user: config.db.user,
          password: config.db.password,
          database: config.db.database,
          waitForConnections: true,
          connectionLimit: 5,
          ssl: config.db.ssl ? {} : undefined
        });

    await this.pool.query("SELECT 1");
    if (config.allowAdditiveMigrations) {
      await this.ensureAdditiveTables();
    }
  }

  async createReceipt(input: ReceiptCreateInput): Promise<ReceiptRecord> {
    await this.query(
      `INSERT INTO receipts
        (id, status, duplicate_hash, image_quality_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [input.id, input.status, input.duplicateHash, json(input.imageQuality ?? null)]
    );
    await this.addAudit(input.id, { action: "receipt_created", actor: "system", payload: { status: input.status } });
    return this.mustGet(input.id);
  }

  async getReceipt(id: string): Promise<ReceiptRecord | null> {
    const [rows] = await this.query<ReceiptRow[]>("SELECT * FROM receipts WHERE id = ? LIMIT 1", [id]);
    const row = rows[0];
    if (!row) return null;
    return this.hydrate(row);
  }

  async listReceipts(filters?: { q?: string; status?: string }): Promise<ReceiptRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters?.status && filters.status !== "all") {
      where.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.q) {
      where.push("(merchant_display_name LIKE ? OR receipt_date LIKE ? OR grand_total_raw LIKE ?)");
      const q = `%${filters.q}%`;
      params.push(q, q, q);
    }
    const [rows] = await this.query<ReceiptRow[]>(
      `SELECT * FROM receipts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async updateReceipt(id: string, patch: ReceiptPatchInput): Promise<ReceiptRecord> {
    const existing = await this.mustGet(id);
    if (patch.status && !canTransitionReceiptStatus(existing.status, patch.status)) {
      throw new AppError(409, "invalid_status_transition", `Nederīga statusa maiņa no ${existing.status} uz ${patch.status}.`);
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, unknown> = {
      status: patch.status,
      merchant_display_name: patch.merchantDisplayName,
      receipt_date: patch.receiptDate,
      receipt_time: patch.receiptTime,
      currency: patch.currency,
      grand_total_cents: patch.grandTotalCents,
      grand_total_raw: patch.grandTotalRaw,
      extraction_json: patch.extraction === undefined ? undefined : json(patch.extraction),
      validation_json: patch.validation === undefined ? undefined : json(patch.validation),
      image_quality_json: patch.imageQuality === undefined ? undefined : json(patch.imageQuality),
      duplicate_hash: patch.duplicateHash,
      failure_reason: patch.failureReason
    };

    for (const [field, value] of Object.entries(map)) {
      if (value !== undefined) {
        fields.push(`${field} = ?`);
        params.push(value);
      }
    }
    if (fields.length) {
      params.push(id);
      await this.query(`UPDATE receipts SET ${fields.join(", ")}, updated_at = NOW() WHERE id = ?`, params);
    }
    if (patch.extraction !== undefined) {
      await this.replaceExtractionChildren(id, patch.extraction, patch.validation ?? null);
    } else if (patch.validation !== undefined) {
      await this.insertValidationSnapshot(id, patch.validation);
    }
    return this.mustGet(id);
  }

  async deleteReceipt(id: string): Promise<boolean> {
    const existing = await this.getReceipt(id);
    if (!existing) return false;

    const childTables = [
      "receipt_extraction_raw",
      "receipt_validation_results",
      "receipt_vat_breakdown",
      "receipt_line_items",
      "receipt_audit_log",
      "receipt_files"
    ];
    for (const table of childTables) {
      await this.query(`DELETE FROM ${table} WHERE receipt_id = ?`, [id]);
    }
    const [result] = await this.query<ResultSetHeader>("DELETE FROM receipts WHERE id = ?", [id]);
    return result.affectedRows > 0;
  }

  async addFile(receiptId: string, file: ReceiptFileRecord): Promise<ReceiptRecord> {
    await this.query(
      `INSERT INTO receipt_files
        (id, receipt_id, kind, storage_key, original_name, mime_type, byte_size, sha256, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [file.id, receiptId, file.kind, file.storageKey, file.originalName, file.mimeType, file.byteSize, file.sha256, file.width, file.height]
    );
    await this.query("UPDATE receipts SET updated_at = NOW() WHERE id = ?", [receiptId]);
    return this.mustGet(receiptId);
  }

  async addAudit(receiptId: string, entry: Omit<ReceiptAuditEntry, "id" | "receiptId" | "createdAt">): Promise<ReceiptRecord> {
    await this.query(
      `INSERT INTO receipt_audit_log (id, receipt_id, action, actor, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [nanoid(), receiptId, entry.action, entry.actor, json(entry.payload)]
    );
    return this.mustGet(receiptId);
  }

  async findDuplicate(input: { imageSha256?: string | null; duplicateHash?: string | null; receiptId?: string | null }): Promise<ReceiptRecord | null> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (input.duplicateHash) {
      clauses.push("r.duplicate_hash = ?");
      params.push(input.duplicateHash);
    }
    if (input.imageSha256) {
      clauses.push("f.sha256 = ?");
      params.push(input.imageSha256);
    }
    if (!clauses.length) return null;
    if (input.receiptId) params.push(input.receiptId);
    const [rows] = await this.query<ReceiptRow[]>(
      `SELECT DISTINCT r.* FROM receipts r
       LEFT JOIN receipt_files f ON f.receipt_id = r.id
       WHERE (${clauses.join(" OR ")}) ${input.receiptId ? "AND r.id <> ?" : ""}
       ORDER BY r.created_at DESC LIMIT 1`,
      params
    );
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  private async hydrate(row: ReceiptRow): Promise<ReceiptRecord> {
    const [files] = await this.query<ReceiptFileRecord[]>(
      `SELECT id, receipt_id as receiptId, kind, storage_key as storageKey, original_name as originalName,
        mime_type as mimeType, byte_size as byteSize, sha256, width, height, created_at as createdAt
       FROM receipt_files WHERE receipt_id = ? ORDER BY created_at ASC`,
      [row.id]
    );
    const [audit] = await this.query<Array<{ id: string; receiptId: string; action: string; actor: string | null; payload_json: string | null; createdAt: Date }>>(
      `SELECT id, receipt_id as receiptId, action, actor, payload_json, created_at as createdAt
       FROM receipt_audit_log WHERE receipt_id = ? ORDER BY created_at DESC LIMIT 200`,
      [row.id]
    );

    return {
      id: row.id,
      status: row.status,
      merchantDisplayName: row.merchant_display_name,
      receiptDate: row.receipt_date,
      receiptTime: row.receipt_time,
      currency: row.currency,
      grandTotalCents: row.grand_total_cents,
      grandTotalRaw: row.grand_total_raw,
      extraction: parseJson(row.extraction_json),
      validation: parseJson(row.validation_json),
      imageQuality: parseJson(row.image_quality_json),
      duplicateHash: row.duplicate_hash,
      failureReason: row.failure_reason,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      files: files.map((file) => ({ ...file, createdAt: new Date(file.createdAt).toISOString() })),
      auditLog: audit.map((entry) => ({
        id: entry.id,
        receiptId: row.id,
        action: entry.action,
        actor: entry.actor,
        payload: parseJson(entry.payload_json),
        createdAt: entry.createdAt.toISOString()
      }))
    };
  }

  private async mustGet(id: string): Promise<ReceiptRecord> {
    const receipt = await this.getReceipt(id);
    if (!receipt) throw new AppError(404, "receipt_not_found", "Čeks nav atrasts.");
    return receipt;
  }

  private async query<T>(sql: string, params: unknown[] = []): Promise<[T, unknown]> {
    if (!this.pool) throw new AppError(500, "db_not_initialized", "Datubāze nav inicializēta.", false);
    return this.pool.query(sql, params) as Promise<[T, unknown]>;
  }

  private async ensureAdditiveTables(): Promise<void> {
    await this.query(`
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
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        INDEX idx_receipts_status (status),
        INDEX idx_receipts_duplicate_hash (duplicate_hash),
        INDEX idx_receipts_date (receipt_date)
      )
    `);
    await this.query(`
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
        created_at DATETIME NOT NULL,
        INDEX idx_receipt_files_receipt_id (receipt_id),
        UNIQUE KEY uq_receipt_file_sha_kind (receipt_id, kind, sha256),
        CONSTRAINT fk_receipt_files_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
      )
    `);
    await this.query(`
      CREATE TABLE IF NOT EXISTS receipt_audit_log (
        id VARCHAR(36) PRIMARY KEY,
        receipt_id VARCHAR(36) NOT NULL,
        action VARCHAR(128) NOT NULL,
        actor VARCHAR(128) NULL,
        payload_json JSON NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_receipt_audit_receipt_id (receipt_id),
        CONSTRAINT fk_receipt_audit_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
      )
    `);
    await this.query(`
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
        created_at DATETIME NOT NULL,
        INDEX idx_receipt_line_items_receipt_id (receipt_id),
        CONSTRAINT fk_receipt_line_items_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
      )
    `);
    await this.query(`
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
        created_at DATETIME NOT NULL,
        INDEX idx_receipt_vat_receipt_id (receipt_id),
        CONSTRAINT fk_receipt_vat_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
      )
    `);
    await this.query(`
      CREATE TABLE IF NOT EXISTS receipt_validation_results (
        id VARCHAR(36) PRIMARY KEY,
        receipt_id VARCHAR(36) NOT NULL,
        status VARCHAR(32) NOT NULL,
        can_verify BOOLEAN NOT NULL,
        issues_json JSON NOT NULL,
        checks_json JSON NOT NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_receipt_validation_receipt_id (receipt_id),
        CONSTRAINT fk_receipt_validation_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
      )
    `);
    await this.query(`
      CREATE TABLE IF NOT EXISTS receipt_extraction_raw (
        id VARCHAR(36) PRIMARY KEY,
        receipt_id VARCHAR(36) NOT NULL,
        provider VARCHAR(64) NULL,
        model VARCHAR(128) NULL,
        extraction_json JSON NOT NULL,
        raw_response_json JSON NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_receipt_extraction_receipt_id (receipt_id),
        CONSTRAINT fk_receipt_extraction_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
      )
    `);
  }

  private async replaceExtractionChildren(receiptId: string, extraction: ReceiptRecord["extraction"], validation: ReceiptRecord["validation"]): Promise<void> {
    if (!extraction) return;
    await this.query("DELETE FROM receipt_line_items WHERE receipt_id = ?", [receiptId]);
    await this.query("DELETE FROM receipt_vat_breakdown WHERE receipt_id = ?", [receiptId]);

    for (const [index, item] of extraction.line_items.entries()) {
      await this.query(
        `INSERT INTO receipt_line_items
          (id, receipt_id, line_index, raw_line_text, item_name, normalized_name, quantity_raw, unit,
           unit_price_raw, unit_price_cents, discount_amount_raw, discount_amount_cents, discount_percent,
           vat_rate, line_total_raw, line_total_cents, item_code_barcode, category, confidence_json, warnings_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          nanoid(),
          receiptId,
          index,
          item.raw_line_text,
          item.item_name,
          item.normalized_name,
          item.quantity == null ? null : String(item.quantity),
          item.unit,
          item.unit_price.raw,
          item.unit_price.cents,
          item.discount_amount.raw,
          item.discount_amount.cents,
          item.discount_percent == null ? null : String(item.discount_percent),
          item.vat_rate == null ? null : String(item.vat_rate),
          item.line_total.raw,
          item.line_total.cents,
          item.item_code_barcode,
          item.category,
          json(item.confidence_per_field),
          json(item.warnings)
        ]
      );
    }

    for (const row of extraction.vat_breakdown) {
      await this.query(
        `INSERT INTO receipt_vat_breakdown
          (id, receipt_id, vat_rate, taxable_amount_raw, taxable_amount_cents, vat_amount_raw, vat_amount_cents,
           gross_amount_raw, gross_amount_cents, raw_text, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          nanoid(),
          receiptId,
          row.vat_rate == null ? null : String(row.vat_rate),
          row.taxable_amount.raw,
          row.taxable_amount.cents,
          row.vat_amount.raw,
          row.vat_amount.cents,
          row.gross_amount.raw,
          row.gross_amount.cents,
          row.raw_text,
          row.confidence
        ]
      );
    }

    await this.query(
      `INSERT INTO receipt_extraction_raw (id, receipt_id, provider, model, extraction_json, raw_response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [nanoid(), receiptId, "openai-or-provider", null, json(extraction), null]
    );
    await this.insertValidationSnapshot(receiptId, validation);
  }

  private async insertValidationSnapshot(receiptId: string, validation: ReceiptRecord["validation"]): Promise<void> {
    if (!validation) return;
    await this.query(
      `INSERT INTO receipt_validation_results (id, receipt_id, status, can_verify, issues_json, checks_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [nanoid(), receiptId, validation.status, validation.canVerify, json(validation.issues), json(validation.checks)]
    );
  }
}

function json(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
