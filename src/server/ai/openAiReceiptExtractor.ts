import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { normalizeExtractedMoneyFields } from "../../shared/receiptValidation.js";
import type { ReceiptExtraction } from "../../shared/receiptTypes.js";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { receiptExtractionSchema } from "./extractionSchema.js";
import type { ReceiptExtractionInput, ReceiptExtractionOutput, ReceiptExtractor } from "./receiptExtractor.js";

export class OpenAiReceiptExtractor implements ReceiptExtractor {
  private readonly client: OpenAI;

  constructor() {
    if (!config.openAiApiKey) {
      throw new AppError(503, "openai_not_configured", "OpenAI atslēga nav konfigurēta.");
    }
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  async extract(input: ReceiptExtractionInput): Promise<ReceiptExtractionOutput> {
    const dataUrl = `data:${input.mimeType};base64,${input.imageBuffer.toString("base64")}`;
    const started = Date.now();
    const completion = await this.client.chat.completions.parse({
      model: config.aiModel,
      temperature: 0,
      response_format: zodResponseFormat(receiptExtractionSchema, "receipt_extraction"),
      messages: [
        {
          role: "system",
          content: strictReceiptSystemPrompt()
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the receipt data from this image. Return only fields visible in the receipt image. Use null and warnings for anything uncertain."
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" }
            }
          ]
        }
      ]
    }).catch((error: unknown) => {
      logger.warn({ err: summarizeOpenAiError(error), receiptId: input.receiptId, model: config.aiModel }, "receipt extraction request failed");
      throw openAiAppError(error);
    });

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      throw new AppError(502, "ai_parse_failed", "AI neatgrieza derīgu strukturētu čeka JSON.");
    }

    logger.info({ receiptId: input.receiptId, provider: "openai", model: config.aiModel, ms: Date.now() - started }, "receipt extraction completed");
    return {
      extraction: normalizeExtractedMoneyFields(parsed as ReceiptExtraction),
      rawResponse: {
        id: completion.id,
        model: completion.model,
        usage: completion.usage,
        request_id: completion._request_id
      },
      provider: "openai"
    };
  }
}

function openAiAppError(error: unknown): AppError {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) {
      return new AppError(503, "openai_auth_failed", "OpenAI atslēga nav derīga vai tai nav piekļuves izvēlētajam modelim.");
    }
    if (error.status === 429) {
      return new AppError(429, "openai_rate_limited", "OpenAI pašlaik ierobežo pieprasījumus. Pamēģini vēlreiz pēc brīža.");
    }
    if (error.status === 400) {
      return new AppError(502, "openai_bad_request", "AI nolasīšanas konfigurāciju neizdevās izpildīt. Pārbaudi modeli un mēģini vēlreiz.");
    }
    return new AppError(502, "openai_failed", "AI nolasīšana neizdevās. Pamēģini vēlreiz.");
  }
  return new AppError(502, "openai_failed", "AI nolasīšana neizdevās. Pamēģini vēlreiz.");
}

function summarizeOpenAiError(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    return {
      status: error.status,
      code: error.code,
      type: error.type,
      request_id: error.requestID,
      message: error.message
    };
  }
  return error instanceof Error ? { name: error.name, message: error.message } : { message: "unknown error" };
}

function strictReceiptSystemPrompt(): string {
  return [
    "You extract accounting receipt data from receipt images.",
    "Be strict and conservative. Never invent missing fields.",
    "If a field is not clearly visible, return null, low confidence, and a warning.",
    "Line item extraction is mandatory: extract every visible printed item line.",
    "Preserve product names, Latvian characters, abbreviations, decimals, and raw printed text exactly where possible.",
    "Do not translate item names. Do not beautify merchant or item names.",
    "Money values must include raw printed strings and normalized integer cents where safely parseable.",
    "If a line is unclear, keep raw_line_text with low confidence instead of guessing.",
    "VAT, totals, payment and line-item math must be represented exactly as printed.",
    "Avoid unnecessary personal data; loyalty card data may be summarized only when visible and relevant.",
    "Return warnings for blur, cut-off text, conflicting numbers, missing totals, and uncertain dates."
  ].join(" ");
}
