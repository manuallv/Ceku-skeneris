import { describe, expect, it } from "vitest";
import { zodResponseFormat } from "openai/helpers/zod";
import { receiptExtractionSchema } from "../src/server/ai/extractionSchema";
import { validExtraction } from "./factories";

describe("AI structured output schema", () => {
  it("accepts the expected structured extraction shape", () => {
    expect(receiptExtractionSchema.safeParse(validExtraction()).success).toBe(true);
  });

  it("rejects malformed AI JSON", () => {
    expect(receiptExtractionSchema.safeParse({ merchant: "invented" }).success).toBe(false);
  });

  it("generates an OpenAI-compatible structured output schema", () => {
    const format = zodResponseFormat(receiptExtractionSchema, "receipt_extraction");
    expect(JSON.stringify(format)).not.toContain("propertyNames");
  });
});
