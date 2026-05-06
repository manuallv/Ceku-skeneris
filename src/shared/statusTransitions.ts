import type { ReceiptStatus } from "./receiptTypes.js";

const allowedTransitions: Record<ReceiptStatus, ReceiptStatus[]> = {
  uploaded: ["image_processed", "failed"],
  image_processed: ["extracted", "needs_review", "failed"],
  extracted: ["needs_review", "verified", "failed"],
  needs_review: ["needs_review", "verified", "failed"],
  verified: ["needs_review", "failed"],
  failed: ["uploaded", "failed"]
};

export function canTransitionReceiptStatus(from: ReceiptStatus, to: ReceiptStatus): boolean {
  if (from === to) return true;
  return allowedTransitions[from]?.includes(to) ?? false;
}
