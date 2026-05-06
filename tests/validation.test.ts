import { describe, expect, it } from "vitest";
import { validateReceiptExtraction } from "../src/shared/receiptValidation";
import { validExtraction } from "./factories";

const context = {
  processedImageExists: true,
  generatedPdfExists: true,
  imageQuality: {
    blurScore: 120,
    brightness: 150,
    overexposureRatio: 0.02,
    edgeConfidence: 0.8,
    lowResolution: false,
    tooDark: false,
    overexposed: false,
    blurry: false,
    cutOffSuspected: false,
    warnings: []
  }
};

describe("strict receipt validation", () => {
  it("allows verified only when all critical checks pass", () => {
    const result = validateReceiptExtraction(validExtraction(), context);
    expect(result.status).toBe("verified");
    expect(result.canVerify).toBe(true);
  });

  it("marks missing required fields as needs_review", () => {
    const result = validateReceiptExtraction(validExtraction({ merchant: { merchant_display_name: null, legal_company_name: null, merchant_confidence: 0.2 } }), context);
    expect(result.status).toBe("needs_review");
    expect(result.issues.some((issue) => issue.code === "merchant_missing")).toBe(true);
  });

  it("marks line item total mismatch as needs_review", () => {
    const extraction = validExtraction({
      line_items: [
        {
          ...validExtraction().line_items[0],
          line_total: { raw: "9,99", cents: 999, currency: "EUR", confidence: 0.95 }
        }
      ]
    });
    const result = validateReceiptExtraction(extraction, context);
    expect(result.status).toBe("needs_review");
    expect(result.issues.some((issue) => issue.code === "line_items_total_mismatch")).toBe(true);
  });

  it("marks VAT math mismatch as needs_review", () => {
    const result = validateReceiptExtraction(
      validExtraction({
        vat_breakdown: [
          {
            ...validExtraction().vat_breakdown[0],
            vat_amount: { raw: "0,99", cents: 99, currency: "EUR", confidence: 0.95 }
          }
        ]
      }),
      context
    );
    expect(result.status).toBe("needs_review");
    expect(result.issues.some((issue) => issue.code === "vat_math_mismatch")).toBe(true);
  });

  it("marks payment conflicts as needs_review", () => {
    const result = validateReceiptExtraction(
      validExtraction({
        payment: {
          ...validExtraction().payment,
          card_amount: { raw: "1,00", cents: 100, currency: "EUR", confidence: 0.95 }
        }
      }),
      context
    );
    expect(result.status).toBe("needs_review");
    expect(result.issues.some((issue) => issue.code === "payment_total_mismatch")).toBe(true);
  });

  it("rejects impossible dates and future dates", () => {
    const impossible = validateReceiptExtraction(validExtraction({ identity: { date: "2026-02-31" } }), context);
    const future = validateReceiptExtraction(validExtraction({ identity: { date: "2099-01-01" } }), context);
    expect(impossible.issues.some((issue) => issue.code === "date_invalid")).toBe(true);
    expect(future.issues.some((issue) => issue.code === "date_invalid")).toBe(true);
  });

  it("marks duplicates and poor image quality as needs_review", () => {
    const duplicate = validateReceiptExtraction(validExtraction(), { ...context, duplicateSuspected: true });
    const blurry = validateReceiptExtraction(validExtraction(), {
      ...context,
      imageQuality: { ...context.imageQuality, blurry: true, warnings: ["Attēls var būt izplūdis."] }
    });
    expect(duplicate.issues.some((issue) => issue.code === "duplicate_suspected")).toBe(true);
    expect(blurry.issues.some((issue) => issue.code === "image_quality_poor")).toBe(true);
  });

  it("handles malformed or missing AI extraction safely", () => {
    const result = validateReceiptExtraction(null, context);
    expect(result.status).toBe("needs_review");
    expect(result.canVerify).toBe(false);
  });
});
