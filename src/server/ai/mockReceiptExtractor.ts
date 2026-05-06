import { normalizeExtractedMoneyFields } from "../../shared/receiptValidation.js";
import { emptyReceiptExtraction } from "./extractionSchema.js";
import type { ReceiptExtractionInput, ReceiptExtractionOutput, ReceiptExtractor } from "./receiptExtractor.js";

export class MockReceiptExtractor implements ReceiptExtractor {
  async extract(input: ReceiptExtractionInput): Promise<ReceiptExtractionOutput> {
    const extraction = normalizeExtractedMoneyFields(emptyReceiptExtraction("OpenAI nav konfigurēts; izmantota droša lokālā mock ekstrakcija."));
    return {
      extraction,
      provider: "mock",
      rawResponse: {
        receiptId: input.receiptId,
        reason: "OPENAI_API_KEY missing"
      }
    };
  }
}
