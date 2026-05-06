import type { ReceiptExtraction } from "../../shared/receiptTypes.js";

export interface ReceiptExtractionInput {
  imageBuffer: Buffer;
  mimeType: string;
  receiptId: string;
  originalImageBuffer?: Buffer;
  originalMimeType?: string;
}

export interface ReceiptExtractionOutput {
  extraction: ReceiptExtraction;
  rawResponse: unknown;
  provider: string;
}

export interface ReceiptExtractor {
  extract(input: ReceiptExtractionInput): Promise<ReceiptExtractionOutput>;
}
