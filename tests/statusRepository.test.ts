import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { LocalReceiptRepository } from "../src/server/repositories/localReceiptRepository";

describe("receipt repository and status transitions", () => {
  it("rejects unsafe status transitions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ceku-repo-"));
    const repository = new LocalReceiptRepository(dir);
    await repository.init();
    await repository.createReceipt({ id: "r1", status: "uploaded", duplicateHash: null });
    await expect(repository.updateReceipt("r1", { status: "verified" })).rejects.toThrow();
  });

  it("stores manual edit audit entries", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ceku-repo-"));
    const repository = new LocalReceiptRepository(dir);
    await repository.init();
    await repository.createReceipt({ id: "r2", status: "uploaded", duplicateHash: null });
    const receipt = await repository.addAudit("r2", { action: "manual_correction", actor: "test", payload: { field: "total" } });
    expect(receipt.auditLog[0].action).toBe("manual_correction");
    expect(receipt.auditLog[0].payload).toEqual({ field: "total" });
  });

  it("detects duplicate image hashes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ceku-repo-"));
    const repository = new LocalReceiptRepository(dir);
    await repository.init();
    await repository.createReceipt({ id: "r3", status: "uploaded", duplicateHash: "hash-1" });
    const duplicate = await repository.findDuplicate({ duplicateHash: "hash-1", receiptId: "r4" });
    expect(duplicate?.id).toBe("r3");
  });

  it("deletes old receipts from the local repository", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ceku-repo-"));
    const repository = new LocalReceiptRepository(dir);
    await repository.init();
    await repository.createReceipt({ id: "r5", status: "uploaded", duplicateHash: null });

    await expect(repository.deleteReceipt("r5")).resolves.toBe(true);
    await expect(repository.getReceipt("r5")).resolves.toBeNull();
    await expect(repository.deleteReceipt("r5")).resolves.toBe(false);
  });
});
