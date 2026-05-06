import { centsEqual, moneyCentsFromValue, parseMoneyToCents } from "./money.js";
import type { ImageQualityReport, ReceiptExtraction, ValidationIssue, ValidationResult } from "./receiptTypes.js";

export interface ValidationContext {
  processedImageExists: boolean;
  generatedPdfExists: boolean;
  duplicateSuspected?: boolean;
  imageQuality?: ImageQualityReport | null;
  now?: Date;
}

const HIGH_CONFIDENCE = 0.82;

export function validateReceiptExtraction(extraction: ReceiptExtraction | null, context: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const checks: Record<string, boolean> = {};

  const fail = (code: string, message: string, field?: string, severity: "warning" | "critical" = "critical") => {
    issues.push({ code, severity, message, field });
  };

  checks.processedImageExists = context.processedImageExists;
  if (!checks.processedImageExists) fail("processed_image_missing", "Apstrādātais čeka attēls nav saglabāts.", "files.processed_image");

  checks.generatedPdfExists = context.generatedPdfExists;
  if (!checks.generatedPdfExists) fail("pdf_missing", "PDF fails nav izveidots.", "files.generated_pdf");

  if (!extraction) {
    fail("extraction_missing", "Nav strukturētas AI ekstrakcijas.");
    return finalize(issues, checks);
  }

  const quality = context.imageQuality;
  checks.imageQualityAcceptable = !quality || (!quality.blurry && !quality.tooDark && !quality.overexposed && !quality.cutOffSuspected && !quality.lowResolution);
  if (!checks.imageQualityAcceptable) {
    fail("image_quality_poor", "Attēla kvalitāte nav pietiekama automātiskai verificēšanai.", "imageQuality");
  }

  const merchant = extraction.merchant.merchant_display_name || extraction.merchant.legal_company_name;
  checks.merchantFound = Boolean(merchant);
  if (!checks.merchantFound) fail("merchant_missing", "Nav droši atrasts tirgotājs.", "merchant");

  checks.merchantConfidence = extraction.merchant.merchant_confidence >= HIGH_CONFIDENCE;
  if (!checks.merchantConfidence) fail("merchant_low_confidence", "Tirgotāja noteikšanas pārliecība ir par zemu.", "merchant.merchant_confidence");

  checks.dateFound = Boolean(extraction.identity.date);
  if (!checks.dateFound) fail("date_missing", "Nav droši atrasts datums.", "identity.date");
  checks.dateValid = validateDate(extraction.identity.date, context.now ?? new Date());
  if (checks.dateFound && !checks.dateValid) fail("date_invalid", "Datums nav derīgs vai ir aizdomīgs.", "identity.date");

  checks.identityConfidence = extraction.identity.receipt_identity_confidence >= HIGH_CONFIDENCE;
  if (!checks.identityConfidence) fail("identity_low_confidence", "Čeka identitātes pārliecība ir par zemu.", "identity.receipt_identity_confidence");

  const grandTotal = moneyCentsFromValue(extraction.totals.grand_total);
  checks.grandTotalFound = grandTotal != null;
  if (!checks.grandTotalFound) fail("grand_total_missing", "Nav droši atrasta gala summa.", "totals.grand_total");
  checks.grandTotalPositive = grandTotal != null && grandTotal >= 0;
  if (grandTotal != null && !checks.grandTotalPositive) fail("grand_total_negative", "Gala summa nevar būt negatīva.", "totals.grand_total");

  checks.totalConfidence = extraction.totals.total_confidence >= HIGH_CONFIDENCE;
  if (!checks.totalConfidence) fail("total_low_confidence", "Summu noteikšanas pārliecība ir par zemu.", "totals.total_confidence");

  checks.currencyFound = Boolean(extraction.identity.currency || extraction.totals.grand_total.currency);
  if (!checks.currencyFound) fail("currency_missing", "Valūta nav skaidri atrasta.", "identity.currency", "warning");

  const currencies = new Set([
    extraction.identity.currency,
    extraction.totals.grand_total.currency,
    ...extraction.line_items.map((item) => item.line_total.currency),
    ...extraction.vat_breakdown.map((row) => row.vat_amount.currency)
  ].filter(Boolean));
  checks.singleCurrency = currencies.size <= 1;
  if (!checks.singleCurrency) fail("multiple_currencies", "Atrastas vairākas valūtas.", "currency");

  checks.lineItemsPresent = extraction.line_items.length > 0;
  if (!checks.lineItemsPresent) fail("line_items_missing", "Čeka pozīcijas nav atrastas.", "line_items");

  const lineSum = sumKnown(extraction.line_items.map((item) => moneyCentsFromValue(item.line_total)));
  checks.lineItemMath = grandTotal == null || lineSum == null || centsEqual(lineSum, grandTotal, 2) || explainableByVatOrDiscount(extraction, lineSum, grandTotal);
  if (!checks.lineItemMath) fail("line_items_total_mismatch", "Pozīciju summa nesakrīt ar gala summu.", "line_items");

  checks.vatMath = validateVatMath(extraction, grandTotal);
  if (!checks.vatMath) fail("vat_math_mismatch", "PVN aprēķini nesakrīt ar redzamajām summām.", "vat_breakdown");

  checks.paymentMath = validatePaymentMath(extraction, grandTotal);
  if (!checks.paymentMath) fail("payment_total_mismatch", "Maksājuma summa nesakrīt ar čeka gala summu.", "payment");

  checks.latvianVatFormat = validateLatvianVat(extraction.merchant.vat_number);
  if (!checks.latvianVatFormat) fail("latvian_vat_invalid", "Latvijas PVN numura formāts nav derīgs.", "merchant.vat_number");

  checks.latvianRegistrationFormat = validateLatvianRegistration(extraction.merchant.registration_number);
  if (!checks.latvianRegistrationFormat) fail("latvian_registration_invalid", "Reģistrācijas numura formāts nav derīgs.", "merchant.registration_number");

  checks.duplicateCheck = !context.duplicateSuspected;
  if (!checks.duplicateCheck) fail("duplicate_suspected", "Iespējams, šis čeks jau ir saglabāts.", "duplicate");

  checks.aiConfidence = extraction.ai_confidence >= HIGH_CONFIDENCE;
  if (!checks.aiConfidence) fail("ai_low_confidence", "AI kopējā pārliecība ir par zemu.", "ai_confidence");

  checks.aiWarningsClear = extraction.extraction_warnings.length === 0;
  for (const warning of extraction.extraction_warnings) {
    issues.push({ code: "ai_warning", severity: "warning", message: warning });
  }

  let lineItemsCertain = true;
  for (const item of extraction.line_items) {
    if (item.line_confidence < HIGH_CONFIDENCE || item.warnings.length > 0) {
      lineItemsCertain = false;
      fail("line_item_uncertain", `Pozīcija "${item.raw_line_text}" nav droša.`, "line_items", "warning");
    }
  }
  checks.lineItemsCertain = lineItemsCertain;

  return finalize(issues, checks);
}

function finalize(issues: ValidationIssue[], checks: Record<string, boolean>): ValidationResult {
  const hasCritical = issues.some((issue) => issue.severity === "critical");
  const everyRequiredCheckPassed = Object.entries(checks)
    .filter(([key]) => !["currencyFound"].includes(key))
    .every(([, passed]) => passed);

  return {
    status: !hasCritical && everyRequiredCheckPassed ? "verified" : "needs_review",
    canVerify: !hasCritical && everyRequiredCheckPassed,
    issues,
    checks
  };
}

function sumKnown(values: Array<number | null>): number | null {
  if (values.some((value) => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function explainableByVatOrDiscount(extraction: ReceiptExtraction, lineSum: number, grandTotal: number): boolean {
  const discount = moneyCentsFromValue(extraction.totals.discounts_total) ?? 0;
  const rounding = moneyCentsFromValue(extraction.totals.rounding_adjustment) ?? 0;
  return centsEqual(lineSum - Math.abs(discount) + rounding, grandTotal, 2);
}

function validateVatMath(extraction: ReceiptExtraction, grandTotal: number | null): boolean {
  if (extraction.vat_breakdown.length === 0) return true;

  for (const row of extraction.vat_breakdown) {
    const taxable = moneyCentsFromValue(row.taxable_amount);
    const vat = moneyCentsFromValue(row.vat_amount);
    const gross = moneyCentsFromValue(row.gross_amount);
    if (taxable != null && vat != null && gross != null && !centsEqual(taxable + vat, gross, 2)) {
      return false;
    }
  }

  const visibleVatRows = extraction.vat_breakdown.map((row) => moneyCentsFromValue(row.vat_amount)).filter((value): value is number => value != null);
  const vatTotal = moneyCentsFromValue(extraction.totals.vat_total);
  if (visibleVatRows.length > 0 && vatTotal != null) {
    const vatRowsSum = visibleVatRows.reduce((sum, value) => sum + value, 0);
    if (!centsEqual(vatRowsSum, vatTotal, 2)) return false;
  }

  const grossRows = extraction.vat_breakdown.map((row) => moneyCentsFromValue(row.gross_amount)).filter((value): value is number => value != null);
  if (grossRows.length > 0 && grandTotal != null) {
    const grossSum = grossRows.reduce((sum, value) => sum + value, 0);
    if (!centsEqual(grossSum, grandTotal, 2)) return false;
  }

  return true;
}

function validatePaymentMath(extraction: ReceiptExtraction, grandTotal: number | null): boolean {
  if (grandTotal == null) return false;
  const paid = moneyCentsFromValue(extraction.totals.paid_amount);
  const cash = moneyCentsFromValue(extraction.payment.cash_amount);
  const card = moneyCentsFromValue(extraction.payment.card_amount);
  const change = moneyCentsFromValue(extraction.totals.change_amount) ?? 0;

  if (cash != null || card != null) {
    return centsEqual((cash ?? 0) + (card ?? 0) - change, grandTotal, 2);
  }

  if (paid != null) {
    return centsEqual(paid - change, grandTotal, 2);
  }

  return true;
}

function validateDate(input: string | null, now: Date): boolean {
  if (!input) return false;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const lvMatch = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(input);
  let year: number;
  let month: number;
  let day: number;

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (lvMatch) {
    day = Number(lvMatch[1]);
    month = Number(lvMatch[2]);
    year = Number(lvMatch[3]);
  } else {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.getTime() <= tomorrow.getTime();
}

function validateLatvianVat(value: string | null): boolean {
  if (!value) return true;
  return /^LV\d{11}$/.test(value.replace(/\s+/g, "").toUpperCase());
}

function validateLatvianRegistration(value: string | null): boolean {
  if (!value) return true;
  return /^\d{11}$/.test(value.replace(/\D/g, ""));
}

export function normalizeExtractedMoneyFields(extraction: ReceiptExtraction): ReceiptExtraction {
  const normalize = <T extends { raw: string | null; cents: number | null }>(money: T): T => {
    if (money.cents == null) {
      const parsed = parseMoneyToCents(money.raw);
      if (parsed) return { ...money, cents: parsed.cents };
    }
    return money;
  };

  return {
    ...extraction,
    totals: {
      ...extraction.totals,
      subtotal: normalize(extraction.totals.subtotal),
      total_before_vat: normalize(extraction.totals.total_before_vat),
      discounts_total: normalize(extraction.totals.discounts_total),
      vat_total: normalize(extraction.totals.vat_total),
      grand_total: normalize(extraction.totals.grand_total),
      rounding_adjustment: normalize(extraction.totals.rounding_adjustment),
      paid_amount: normalize(extraction.totals.paid_amount),
      change_amount: normalize(extraction.totals.change_amount),
      amount_due: normalize(extraction.totals.amount_due)
    },
    line_items: extraction.line_items.map((item) => ({
      ...item,
      unit_price: normalize(item.unit_price),
      discount_amount: normalize(item.discount_amount),
      line_total: normalize(item.line_total)
    })),
    vat_breakdown: extraction.vat_breakdown.map((row) => ({
      ...row,
      taxable_amount: normalize(row.taxable_amount),
      vat_amount: normalize(row.vat_amount),
      gross_amount: normalize(row.gross_amount)
    })),
    payment: {
      ...extraction.payment,
      cash_amount: normalize(extraction.payment.cash_amount),
      card_amount: normalize(extraction.payment.card_amount)
    }
  };
}
