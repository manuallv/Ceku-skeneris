import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ReceiptAuditEntry, ReceiptRecord } from "../../shared/receiptTypes.js";
import { canTransitionReceiptStatus } from "../../shared/statusTransitions.js";
import { AppError } from "../errors.js";
import type { ReceiptCreateInput, ReceiptPatchInput, ReceiptRepository } from "./receiptRepository.js";

interface LocalState {
  receipts: ReceiptRecord[];
}

export class LocalReceiptRepository implements ReceiptRepository {
  readonly kind = "local" as const;
  private readonly filePath: string;
  private state: LocalState = { receipts: [] };

  constructor(rootDir: string) {
    this.filePath = path.join(rootDir, "receipts.local.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.state = JSON.parse(await fs.readFile(this.filePath, "utf8")) as LocalState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.flush();
    }
  }

  async createReceipt(input: ReceiptCreateInput): Promise<ReceiptRecord> {
    const now = new Date().toISOString();
    const record: ReceiptRecord = {
      id: input.id,
      status: input.status,
      merchantDisplayName: null,
      receiptDate: null,
      receiptTime: null,
      currency: null,
      grandTotalCents: null,
      grandTotalRaw: null,
      extraction: null,
      validation: null,
      imageQuality: input.imageQuality ?? null,
      duplicateHash: input.duplicateHash,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      files: [],
      auditLog: []
    };
    this.state.receipts.unshift(record);
    await this.flush();
    return structuredClone(record);
  }

  async getReceipt(id: string): Promise<ReceiptRecord | null> {
    const receipt = this.state.receipts.find((item) => item.id === id);
    return receipt ? structuredClone(receipt) : null;
  }

  async listReceipts(filters?: { q?: string; status?: string }): Promise<ReceiptRecord[]> {
    const q = filters?.q?.toLowerCase().trim();
    return this.state.receipts
      .filter((receipt) => !filters?.status || filters.status === "all" || receipt.status === filters.status)
      .filter((receipt) => {
        if (!q) return true;
        return [receipt.merchantDisplayName, receipt.receiptDate, receipt.grandTotalRaw, receipt.status]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .map((receipt) => structuredClone(receipt));
  }

  async updateReceipt(id: string, patch: ReceiptPatchInput): Promise<ReceiptRecord> {
    const receipt = this.findOrThrow(id);
    if (patch.status && !canTransitionReceiptStatus(receipt.status, patch.status)) {
      throw new AppError(409, "invalid_status_transition", `Nederīga statusa maiņa no ${receipt.status} uz ${patch.status}.`);
    }
    Object.assign(receipt, patch, { updatedAt: new Date().toISOString() });
    await this.flush();
    return structuredClone(receipt);
  }

  async addFile(receiptId: string, file: ReceiptRecord["files"][number]): Promise<ReceiptRecord> {
    const receipt = this.findOrThrow(receiptId);
    receipt.files = receipt.files.filter((existing) => existing.kind !== file.kind || existing.sha256 !== file.sha256);
    receipt.files.push(file);
    receipt.updatedAt = new Date().toISOString();
    await this.flush();
    return structuredClone(receipt);
  }

  async addAudit(receiptId: string, entry: Omit<ReceiptAuditEntry, "id" | "receiptId" | "createdAt">): Promise<ReceiptRecord> {
    const receipt = this.findOrThrow(receiptId);
    receipt.auditLog.unshift({
      id: nanoid(),
      receiptId,
      createdAt: new Date().toISOString(),
      ...entry
    });
    receipt.updatedAt = new Date().toISOString();
    await this.flush();
    return structuredClone(receipt);
  }

  async findDuplicate(input: { imageSha256?: string | null; duplicateHash?: string | null; receiptId?: string | null }): Promise<ReceiptRecord | null> {
    const duplicate = this.state.receipts.find((receipt) => {
      if (receipt.id === input.receiptId) return false;
      if (input.duplicateHash && receipt.duplicateHash === input.duplicateHash) return true;
      if (input.imageSha256 && receipt.files.some((file) => file.sha256 === input.imageSha256)) return true;
      return false;
    });
    return duplicate ? structuredClone(duplicate) : null;
  }

  private findOrThrow(id: string): ReceiptRecord {
    const receipt = this.state.receipts.find((item) => item.id === id);
    if (!receipt) throw new AppError(404, "receipt_not_found", "Čeks nav atrasts.");
    return receipt;
  }

  private async flush(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2));
    await fs.rename(tmp, this.filePath);
  }
}
