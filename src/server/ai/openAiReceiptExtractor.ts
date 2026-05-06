import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
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
    const processedDataUrl = `data:${input.mimeType};base64,${input.imageBuffer.toString("base64")}`;
    const originalDataUrl =
      input.originalImageBuffer && input.originalMimeType
        ? `data:${input.originalMimeType};base64,${input.originalImageBuffer.toString("base64")}`
        : null;
    const started = Date.now();
    const response = await this.client.responses.parse({
      model: config.aiModel,
      instructions: strictReceiptSystemPrompt(),
      reasoning: { effort: "low" },
      text: {
        format: zodTextFormat(receiptExtractionSchema, "receipt_extraction"),
        verbosity: "low"
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: [
                "Extract the receipt data from these images.",
                "Use the original camera photo for context and any text that the enhancement may have damaged.",
                "Use the processed scan for straightened layout and contrast.",
                "Return only fields visible in the receipt image. Use null and warnings for anything uncertain."
              ].join(" ")
            },
            ...(originalDataUrl
              ? [{
                  type: "input_image" as const,
                  image_url: originalDataUrl,
                  detail: "original" as const
                }]
              : []),
            {
              type: "input_image" as const,
              image_url: processedDataUrl,
              detail: "high" as const
            }
          ]
        }
      ],
      max_output_tokens: 9000
    }).catch((error: unknown) => {
      logger.warn({ err: summarizeOpenAiError(error), receiptId: input.receiptId, model: config.aiModel }, "receipt extraction request failed");
      throw openAiAppError(error);
    });

    const parsed = response.output_parsed;
    if (!parsed) {
      throw new AppError(502, "ai_parse_failed", "AI neatgrieza derīgu strukturētu čeka JSON.");
    }

    logger.info({ receiptId: input.receiptId, provider: "openai", model: config.aiModel, ms: Date.now() - started }, "receipt extraction completed");
    return {
      extraction: normalizeExtractedMoneyFields(parsed as ReceiptExtraction),
      rawResponse: {
        id: response.id,
        model: response.model,
        status: response.status,
        usage: response.usage,
        request_id: response._request_id,
        output_text: response.output_text,
        parsed
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
    "For each line item, fill accounting_description with a short Latvian explanation or translation of what was likely purchased, based only on the visible printed line. Keep it useful for bookkeeping, but use null and a warning if the line is too uncertain.",
    "Money values must include raw printed strings and normalized integer cents where safely parseable.",
    "If a line is unclear, keep raw_line_text with low confidence instead of guessing.",
    "VAT, totals, payment and line-item math must be represented exactly as printed.",
    "Avoid unnecessary personal data; loyalty card data may be summarized only when visible and relevant.",
    "Return warnings for blur, cut-off text, conflicting numbers, missing totals, and uncertain dates."
  ].join(" ");
}
