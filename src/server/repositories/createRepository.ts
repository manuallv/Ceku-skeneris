import { config } from "../config.js";
import { LocalReceiptRepository } from "./localReceiptRepository.js";
import { MySqlReceiptRepository } from "./mysqlReceiptRepository.js";
import type { ReceiptRepository } from "./receiptRepository.js";

export async function createReceiptRepository(): Promise<ReceiptRepository> {
  const hasDatabase = Boolean(config.databaseUrl || (config.db.host && config.db.user && config.db.database));
  const repository: ReceiptRepository = hasDatabase
    ? new MySqlReceiptRepository()
    : new LocalReceiptRepository(config.localStorageDir);
  await repository.init();
  return repository;
}
