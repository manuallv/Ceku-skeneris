import { config } from "../config.js";
import type { ReceiptExtractor } from "./receiptExtractor.js";
import { MockReceiptExtractor } from "./mockReceiptExtractor.js";
import { OpenAiReceiptExtractor } from "./openAiReceiptExtractor.js";

export function createReceiptExtractor(): ReceiptExtractor {
  if (config.aiProvider === "openai" && config.openAiApiKey) return new OpenAiReceiptExtractor();
  return new MockReceiptExtractor();
}
