import type { ImageQualityReport, ReceiptExtraction, ReceiptRecord } from "../shared/receiptTypes";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Pieprasījums neizdevās.");
  }
  return payload as T;
}

export const api = {
  health: () => request<{ ok: boolean; repository: string; openAiConfigured: boolean; storageWritable: boolean; node: string }>("/api/health"),
  systemCheck: () => request<{ database: unknown; ai: unknown; storage: unknown; app: unknown }>("/api/system/check"),
  listReceipts: (params: { q?: string; status?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.status && params.status !== "all") search.set("status", params.status);
    return request<{ receipts: ReceiptRecord[] }>(`/api/receipts?${search}`);
  },
  getReceipt: (id: string) => request<{ receipt: ReceiptRecord }>(`/api/receipts/${id}`),
  uploadReceipt: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<{ receipt: ReceiptRecord }>("/api/receipts/upload", { method: "POST", body: form });
  },
  processReceipt: (id: string, processedImage: Blob, imageQuality: ImageQualityReport, corners: unknown) => {
    const form = new FormData();
    form.set("processedImage", processedImage, "processed-receipt.png");
    form.set("imageQuality", JSON.stringify(imageQuality));
    form.set("corners", JSON.stringify(corners));
    return request<{ receipt: ReceiptRecord }>(`/api/receipts/${id}/process`, { method: "POST", body: form });
  },
  extractReceipt: (id: string) => request<{ receipt: ReceiptRecord }>(`/api/receipts/${id}/extract`, { method: "POST" }),
  updateExtraction: (id: string, extraction: ReceiptExtraction) =>
    request<{ receipt: ReceiptRecord }>(`/api/receipts/${id}/extraction`, { method: "PATCH", body: JSON.stringify({ extraction }) }),
  verifyReceipt: (id: string) => request<{ receipt: ReceiptRecord }>(`/api/receipts/${id}/verify`, { method: "POST" }),
  markNeedsReview: (id: string, reason?: string) =>
    request<{ receipt: ReceiptRecord }>(`/api/receipts/${id}/needs-review`, { method: "POST", body: JSON.stringify({ reason }) }),
  voidReceipt: (id: string, reason?: string) =>
    request<{ receipt: ReceiptRecord }>(`/api/receipts/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) })
};

export function fileUrl(receiptId: string, fileId: string): string {
  return new URL(`/files/${receiptId}/${fileId}`, window.location.origin).toString();
}
