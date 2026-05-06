import type { ReceiptExtraction } from "../src/shared/receiptTypes";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

const money = (raw: string | null, cents: number | null, confidence = 0.95) => ({
  raw,
  cents,
  currency: "EUR",
  confidence
});

const lineConfidence = (confidence = 0.94) => ({
  raw_line_text: confidence,
  item_name: confidence,
  normalized_name: confidence,
  quantity: confidence,
  unit: confidence,
  unit_price: confidence,
  discount_amount: confidence,
  discount_percent: confidence,
  vat_rate: confidence,
  line_total: confidence,
  item_code_barcode: confidence,
  category: confidence
});

export function validExtraction(overrides: DeepPartial<ReceiptExtraction> = {}): ReceiptExtraction {
  const base: ReceiptExtraction = {
    merchant: {
      merchant_display_name: "SIA Tests",
      legal_company_name: "SIA Tests",
      registration_number: "40103000000",
      vat_number: "LV40103000000",
      address: "Rīga",
      phone: null,
      email: null,
      website: null,
      store_location: null,
      merchant_confidence: 0.96
    },
    identity: {
      receipt_number: "R-100",
      document_number: null,
      transaction_number: "T-1",
      fiscal_number: null,
      cash_register_number: null,
      POS_number: null,
      terminal_number: null,
      cashier_operator: null,
      date: "2026-05-01",
      time: "12:30",
      timezone: "Europe/Riga",
      currency: "EUR",
      language: "lv",
      receipt_identity_confidence: 0.94
    },
    line_items: [
      {
        raw_line_text: "MAIZE 1 x 1,20 1,20",
        item_name: "MAIZE",
        normalized_name: null,
        quantity: "1",
        unit: "gab",
        unit_price: money("1,20", 120),
        discount_amount: money(null, null),
        discount_percent: null,
        vat_rate: "21",
        line_total: money("1,20", 120),
        item_code_barcode: null,
        category: null,
        confidence_per_field: lineConfidence(),
        line_confidence: 0.94,
        warnings: []
      },
      {
        raw_line_text: "PIENS 1 x 2,10 2,10",
        item_name: "PIENS",
        normalized_name: null,
        quantity: "1",
        unit: "gab",
        unit_price: money("2,10", 210),
        discount_amount: money(null, null),
        discount_percent: null,
        vat_rate: "21",
        line_total: money("2,10", 210),
        item_code_barcode: null,
        category: null,
        confidence_per_field: lineConfidence(),
        line_confidence: 0.94,
        warnings: []
      }
    ],
    totals: {
      subtotal: money("3,30", 330),
      total_before_vat: money("2,73", 273),
      discounts_total: money(null, null),
      vat_total: money("0,57", 57),
      grand_total: money("3,30", 330),
      rounding_adjustment: money(null, null),
      paid_amount: money("3,30", 330),
      change_amount: money(null, null),
      amount_due: money("3,30", 330),
      total_confidence: 0.96
    },
    vat_breakdown: [
      {
        vat_rate: "21",
        taxable_amount: money("2,73", 273),
        vat_amount: money("0,57", 57),
        gross_amount: money("3,30", 330),
        raw_text: "PVN 21% 2,73 0,57 3,30",
        confidence: 0.95
      }
    ],
    payment: {
      payment_method: "card",
      cash_amount: money(null, null),
      card_amount: money("3,30", 330),
      card_masked_digits: "1234",
      authorization_code: null,
      payment_terminal_id: null,
      transaction_id: null,
      payment_time: "12:30",
      payment_confidence: 0.94
    },
    QR_code_data: null,
    barcode_data: null,
    loyalty_card: null,
    raw_ocr_text: "SIA Tests\nMAIZE\nPIENS\nKOPĀ 3,30",
    full_extraction_text: "SIA Tests\nMAIZE\nPIENS\nKOPĀ 3,30",
    ai_confidence: 0.94,
    extraction_warnings: [],
    fields_not_found: []
  };

  return deepMerge(base, overrides);
}

function deepMerge<T>(target: T, source: DeepPartial<T>): T {
  const output = structuredClone(target);
  for (const [key, value] of Object.entries(source) as Array<[keyof T, DeepPartial<T[keyof T]>]>) {
    if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object") {
      output[key] = deepMerge(output[key], value as DeepPartial<T[keyof T]>);
    } else {
      output[key] = value as T[keyof T];
    }
  }
  return output;
}
