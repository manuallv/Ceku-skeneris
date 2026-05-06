import type { ReceiptAuditEntry, ReceiptFileRecord, ReceiptRecord, ReceiptStatus, ValidationResult } from "../../shared/receiptTypes.js";

export interface ReceiptCreateInput {
  id: string;
  status: ReceiptStatus;
  duplicateHash: string | null;
  imageQuality?: ReceiptRecord["imageQuality"];
}

export interface ReceiptPatchInput {
  status?: ReceiptStatus;
  merchantDisplayName?: string | null;
  receiptDate?: string | null;
  receiptTime?: string | null;
  currency?: string | null;
  grandTotalCents?: number | null;
  grandTotalRaw?: string | null;
  extraction?: ReceiptRecord["extraction"];
  validation?: ValidationResult | null;
  imageQuality?: ReceiptRecord["imageQuality"];
  duplicateHash?: string | null;
  failureReason?: string | null;
}

export interface ReceiptRepository {
  kind: "local" | "mysql";
  init(): Promise<void>;
  createReceipt(input: ReceiptCreateInput): Promise<ReceiptRecord>;
  getReceipt(id: string): Promise<ReceiptRecord | null>;
  listReceipts(filters?: { q?: string; status?: string }): Promise<ReceiptRecord[]>;
  updateReceipt(id: string, patch: ReceiptPatchInput): Promise<ReceiptRecord>;
  deleteReceipt(id: string): Promise<boolean>;
  addFile(receiptId: string, file: ReceiptFileRecord): Promise<ReceiptRecord>;
  addAudit(receiptId: string, entry: Omit<ReceiptAuditEntry, "id" | "receiptId" | "createdAt">): Promise<ReceiptRecord>;
  findDuplicate(input: { imageSha256?: string | null; duplicateHash?: string | null; receiptId?: string | null }): Promise<ReceiptRecord | null>;
}
