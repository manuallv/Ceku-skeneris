import { z } from "zod";

const confidence = z.number().min(0).max(1);

const moneySchema = z.object({
  raw: z.string().nullable(),
  cents: z.number().int().nullable(),
  currency: z.string().nullable(),
  confidence: confidence.nullable()
}).strict();

const lineItemConfidenceSchema = z.object({
  raw_line_text: confidence,
  item_name: confidence,
  normalized_name: confidence,
  accounting_description: confidence,
  quantity: confidence,
  unit: confidence,
  unit_price: confidence,
  discount_amount: confidence,
  discount_percent: confidence,
  vat_rate: confidence,
  line_total: confidence,
  item_code_barcode: confidence,
  category: confidence
}).strict();

export const receiptExtractionSchema = z.object({
  merchant: z.object({
    merchant_display_name: z.string().nullable(),
    legal_company_name: z.string().nullable(),
    registration_number: z.string().nullable(),
    vat_number: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    website: z.string().nullable(),
    store_location: z.string().nullable(),
    merchant_confidence: confidence
  }).strict(),
  identity: z.object({
    receipt_number: z.string().nullable(),
    document_number: z.string().nullable(),
    transaction_number: z.string().nullable(),
    fiscal_number: z.string().nullable(),
    cash_register_number: z.string().nullable(),
    POS_number: z.string().nullable(),
    terminal_number: z.string().nullable(),
    cashier_operator: z.string().nullable(),
    date: z.string().nullable(),
    time: z.string().nullable(),
    timezone: z.string().nullable(),
    currency: z.string().nullable(),
    language: z.string().nullable(),
    receipt_identity_confidence: confidence
  }).strict(),
  line_items: z.array(z.object({
    raw_line_text: z.string(),
    item_name: z.string().nullable(),
    normalized_name: z.string().nullable(),
    accounting_description: z.string().nullable(),
    quantity: z.union([z.string(), z.number()]).nullable(),
    unit: z.string().nullable(),
    unit_price: moneySchema,
    discount_amount: moneySchema,
    discount_percent: z.union([z.string(), z.number()]).nullable(),
    vat_rate: z.union([z.string(), z.number()]).nullable(),
    line_total: moneySchema,
    item_code_barcode: z.string().nullable(),
    category: z.string().nullable(),
    confidence_per_field: lineItemConfidenceSchema,
    line_confidence: confidence,
    warnings: z.array(z.string())
  }).strict()),
  totals: z.object({
    subtotal: moneySchema,
    total_before_vat: moneySchema,
    discounts_total: moneySchema,
    vat_total: moneySchema,
    grand_total: moneySchema,
    rounding_adjustment: moneySchema,
    paid_amount: moneySchema,
    change_amount: moneySchema,
    amount_due: moneySchema,
    total_confidence: confidence
  }).strict(),
  vat_breakdown: z.array(z.object({
    vat_rate: z.union([z.string(), z.number()]).nullable(),
    taxable_amount: moneySchema,
    vat_amount: moneySchema,
    gross_amount: moneySchema,
    raw_text: z.string().nullable(),
    confidence
  }).strict()),
  payment: z.object({
    payment_method: z.string().nullable(),
    cash_amount: moneySchema,
    card_amount: moneySchema,
    card_masked_digits: z.string().nullable(),
    authorization_code: z.string().nullable(),
    payment_terminal_id: z.string().nullable(),
    transaction_id: z.string().nullable(),
    payment_time: z.string().nullable(),
    payment_confidence: confidence
  }).strict(),
  QR_code_data: z.string().nullable(),
  barcode_data: z.string().nullable(),
  loyalty_card: z.string().nullable(),
  raw_ocr_text: z.string().nullable(),
  full_extraction_text: z.string().nullable(),
  ai_confidence: confidence,
  extraction_warnings: z.array(z.string()),
  fields_not_found: z.array(z.string())
}).strict();

export type ReceiptExtractionFromAi = z.infer<typeof receiptExtractionSchema>;

export function emptyReceiptExtraction(warning: string): ReceiptExtractionFromAi {
  const emptyMoney = { raw: null, cents: null, currency: null, confidence: 0 };
  return {
    merchant: {
      merchant_display_name: null,
      legal_company_name: null,
      registration_number: null,
      vat_number: null,
      address: null,
      phone: null,
      email: null,
      website: null,
      store_location: null,
      merchant_confidence: 0
    },
    identity: {
      receipt_number: null,
      document_number: null,
      transaction_number: null,
      fiscal_number: null,
      cash_register_number: null,
      POS_number: null,
      terminal_number: null,
      cashier_operator: null,
      date: null,
      time: null,
      timezone: null,
      currency: null,
      language: null,
      receipt_identity_confidence: 0
    },
    line_items: [],
    totals: {
      subtotal: emptyMoney,
      total_before_vat: emptyMoney,
      discounts_total: emptyMoney,
      vat_total: emptyMoney,
      grand_total: emptyMoney,
      rounding_adjustment: emptyMoney,
      paid_amount: emptyMoney,
      change_amount: emptyMoney,
      amount_due: emptyMoney,
      total_confidence: 0
    },
    vat_breakdown: [],
    payment: {
      payment_method: null,
      cash_amount: emptyMoney,
      card_amount: emptyMoney,
      card_masked_digits: null,
      authorization_code: null,
      payment_terminal_id: null,
      transaction_id: null,
      payment_time: null,
      payment_confidence: 0
    },
    QR_code_data: null,
    barcode_data: null,
    loyalty_card: null,
    raw_ocr_text: null,
    full_extraction_text: null,
    ai_confidence: 0,
    extraction_warnings: [warning],
    fields_not_found: ["all"]
  };
}
