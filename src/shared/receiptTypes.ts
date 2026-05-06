export const receiptStatuses = [
  "uploaded",
  "image_processed",
  "extracted",
  "needs_review",
  "verified",
  "failed"
] as const;

export type ReceiptStatus = (typeof receiptStatuses)[number];

export type StatusSeverity = "neutral" | "info" | "success" | "warning" | "danger";

export interface MoneyValue {
  raw: string | null;
  cents: number | null;
  currency?: string | null;
  confidence?: number | null;
}

export interface ReceiptFileRecord {
  id: string;
  receiptId: string;
  kind: "original_image" | "processed_image" | "generated_pdf" | "thumbnail" | "extraction_debug_json" | "raw_ai_response_json";
  storageKey: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width?: number | null;
  height?: number | null;
  createdAt: string;
}

export interface ImageQualityReport {
  blurScore: number | null;
  brightness: number | null;
  overexposureRatio: number | null;
  edgeConfidence: number | null;
  lowResolution: boolean;
  tooDark: boolean;
  overexposed: boolean;
  blurry: boolean;
  cutOffSuspected: boolean;
  warnings: string[];
}

export interface ExtractedMerchant {
  merchant_display_name: string | null;
  legal_company_name: string | null;
  registration_number: string | null;
  vat_number: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  store_location: string | null;
  merchant_confidence: number;
}

export interface ExtractedReceiptIdentity {
  receipt_number: string | null;
  document_number: string | null;
  transaction_number: string | null;
  fiscal_number: string | null;
  cash_register_number: string | null;
  POS_number: string | null;
  terminal_number: string | null;
  cashier_operator: string | null;
  date: string | null;
  time: string | null;
  timezone: string | null;
  currency: string | null;
  language: string | null;
  receipt_identity_confidence: number;
}

export interface ExtractedLineItem {
  raw_line_text: string;
  item_name: string | null;
  normalized_name: string | null;
  accounting_description: string | null;
  quantity: string | number | null;
  unit: string | null;
  unit_price: MoneyValue;
  discount_amount: MoneyValue;
  discount_percent: string | number | null;
  vat_rate: string | number | null;
  line_total: MoneyValue;
  item_code_barcode: string | null;
  category: string | null;
  confidence_per_field: Record<string, number>;
  line_confidence: number;
  warnings: string[];
}

export interface ExtractedVatBreakdown {
  vat_rate: string | number | null;
  taxable_amount: MoneyValue;
  vat_amount: MoneyValue;
  gross_amount: MoneyValue;
  raw_text: string | null;
  confidence: number;
}

export interface ExtractedTotals {
  subtotal: MoneyValue;
  total_before_vat: MoneyValue;
  discounts_total: MoneyValue;
  vat_total: MoneyValue;
  grand_total: MoneyValue;
  rounding_adjustment: MoneyValue;
  paid_amount: MoneyValue;
  change_amount: MoneyValue;
  amount_due: MoneyValue;
  total_confidence: number;
}

export interface ExtractedPayment {
  payment_method: string | null;
  cash_amount: MoneyValue;
  card_amount: MoneyValue;
  card_masked_digits: string | null;
  authorization_code: string | null;
  payment_terminal_id: string | null;
  transaction_id: string | null;
  payment_time: string | null;
  payment_confidence: number;
}

export interface ReceiptExtraction {
  merchant: ExtractedMerchant;
  identity: ExtractedReceiptIdentity;
  line_items: ExtractedLineItem[];
  totals: ExtractedTotals;
  vat_breakdown: ExtractedVatBreakdown[];
  payment: ExtractedPayment;
  QR_code_data: string | null;
  barcode_data: string | null;
  loyalty_card: string | null;
  raw_ocr_text: string | null;
  full_extraction_text: string | null;
  ai_confidence: number;
  extraction_warnings: string[];
  fields_not_found: string[];
}

export interface ValidationIssue {
  code: string;
  severity: "warning" | "critical";
  message: string;
  field?: string;
}

export interface ValidationResult {
  status: ReceiptStatus;
  canVerify: boolean;
  issues: ValidationIssue[];
  checks: Record<string, boolean>;
}

export interface ReceiptRecord {
  id: string;
  status: ReceiptStatus;
  merchantDisplayName: string | null;
  receiptDate: string | null;
  receiptTime: string | null;
  currency: string | null;
  grandTotalCents: number | null;
  grandTotalRaw: string | null;
  extraction: ReceiptExtraction | null;
  validation: ValidationResult | null;
  imageQuality: ImageQualityReport | null;
  duplicateHash: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  files: ReceiptFileRecord[];
  auditLog: ReceiptAuditEntry[];
}

export interface ReceiptAuditEntry {
  id: string;
  receiptId: string;
  action: string;
  actor: string | null;
  payload: unknown;
  createdAt: string;
}

export interface ReceiptListFilters {
  q?: string;
  status?: ReceiptStatus | "all";
}
