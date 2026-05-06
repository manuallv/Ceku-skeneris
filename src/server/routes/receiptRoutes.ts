import type { Router } from "express";
import express from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { normalizeExtractedMoneyFields, validateReceiptExtraction } from "../../shared/receiptValidation.js";
import type { ImageQualityReport, ReceiptExtraction, ReceiptRecord, ReceiptStatus } from "../../shared/receiptTypes.js";
import { config } from "../config.js";
import { AppError, isAppError } from "../errors.js";
import { getActor } from "../security.js";
import type { ReceiptExtractor } from "../ai/receiptExtractor.js";
import type { ReceiptRepository } from "../repositories/receiptRepository.js";
import { LocalFileStorage, sha256 } from "../storage/localStorage.js";

const allowedImageMimes = new Set(["image/jpeg", "image/jpg", "image/png"]);

export function createReceiptRouter(deps: {
  repository: ReceiptRepository;
  storage: LocalFileStorage;
  extractor: ReceiptExtractor;
}): Router {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1 }
  });

  router.get("/", async (req, res) => {
    const receipts = await deps.repository.listReceipts({
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined
    });
    res.json({ receipts });
  });

  router.post("/upload", upload.single("file"), async (req, res) => {
    const file = requireUpload(req.file);
    validateImageUpload(file);

    const receiptId = nanoid();
    const imageHash = sha256(file.buffer);
    const duplicate = await deps.repository.findDuplicate({ imageSha256: imageHash });
    const receipt = await deps.repository.createReceipt({
      id: receiptId,
      status: "uploaded",
      duplicateHash: imageHash
    });
    const originalFile = await deps.storage.saveBuffer({
      receiptId,
      kind: "original_image",
      buffer: file.buffer,
      originalName: file.originalname || "receipt-image",
      mimeType: normalizedMime(file.mimetype)
    });
    await deps.repository.addFile(receiptId, originalFile);
    await deps.repository.addAudit(receiptId, {
      action: "original_uploaded",
      actor: getActor(req),
      payload: {
        fileId: originalFile.id,
        duplicateSuspected: Boolean(duplicate)
      }
    });

    const updated = duplicate
      ? await deps.repository.updateReceipt(receiptId, {
          validation: {
            status: "needs_review",
            canVerify: false,
            issues: [{ code: "duplicate_suspected", severity: "critical", message: "Iespējams, čeks jau ir augšupielādēts.", field: "duplicate" }],
            checks: { duplicateCheck: false }
          }
        })
      : await deps.repository.getReceipt(receipt.id);

    res.status(201).json({ receipt: updated });
  });

  router.post("/ai-debug", upload.single("file"), async (req, res) => {
    const file = requireUpload(req.file);
    validateImageUpload(file);
    const started = Date.now();
    const mimeType = normalizedMime(file.mimetype);

    try {
      const output = await deps.extractor.extract({
        receiptId: `debug-${nanoid()}`,
        imageBuffer: file.buffer,
        mimeType,
        originalImageBuffer: file.buffer,
        originalMimeType: mimeType
      });
      const extraction = normalizeExtractedMoneyFields(output.extraction);
      const validation = validateReceiptExtraction(extraction, {
        processedImageExists: true,
        generatedPdfExists: true,
        duplicateSuspected: false,
        imageQuality: null
      });

      res.json({
        ok: true,
        provider: output.provider,
        model: modelFromRawResponse(output.rawResponse) ?? config.aiModel,
        ms: Date.now() - started,
        image: {
          name: file.originalname || "receipt-image",
          mimeType,
          byteSize: file.size
        },
        extraction,
        validation,
        rawResponse: output.rawResponse
      });
    } catch (error) {
      const appError = isAppError(error) ? error : new AppError(500, "ai_debug_failed", "AI diagnostika neizdevās.");
      res.json({
        ok: false,
        provider: config.openAiApiKey ? config.aiProvider : "mock",
        model: config.aiModel,
        ms: Date.now() - started,
        image: {
          name: file.originalname || "receipt-image",
          mimeType,
          byteSize: file.size
        },
        error: {
          code: appError.code,
          message: safeErrorMessage(appError.expose ? appError.message : "Servera kļūda."),
          statusCode: appError.statusCode
        }
      });
    }
  });

  router.get("/:id", async (req, res) => {
    res.json({ receipt: await requireReceipt(deps.repository, String(req.params.id)) });
  });

  router.delete("/:id", async (req, res) => {
    const receipt = await requireReceipt(deps.repository, String(req.params.id));
    await deps.repository.deleteReceipt(receipt.id);
    await deps.storage.deleteReceiptFiles(receipt.id, receipt.files.map((file) => file.storageKey));
    res.json({ ok: true });
  });

  router.post("/:id/process", upload.single("processedImage"), async (req, res) => {
    const receipt = await requireReceipt(deps.repository, String(req.params.id));
    const file = requireUpload(req.file);
    validateImageUpload(file);
    const imageQuality = parseJsonBody<ImageQualityReport | null>(req.body.imageQuality, null);
    const corners = parseJsonBody(req.body.corners, null);

    const processedFile = await deps.storage.saveBuffer({
      receiptId: receipt.id,
      kind: "processed_image",
      buffer: file.buffer,
      originalName: "processed-receipt.png",
      mimeType: normalizedMime(file.mimetype)
    });
    await deps.repository.addFile(receipt.id, processedFile);

    const pdfFile = await deps.storage.createReceiptPdf({
      receiptId: receipt.id,
      processedImage: file.buffer,
      processedMimeType: normalizedMime(file.mimetype),
      merchantName: receipt.merchantDisplayName,
      receiptDate: receipt.receiptDate
    });
    await deps.repository.addFile(receipt.id, pdfFile);
    await deps.repository.addAudit(receipt.id, {
      action: "image_processed",
      actor: getActor(req),
      payload: { processedFileId: processedFile.id, pdfFileId: pdfFile.id, corners }
    });

    const updated = await deps.repository.updateReceipt(receipt.id, {
      status: "image_processed",
      imageQuality
    });
    res.json({ receipt: updated });
  });

  router.post("/:id/extract", async (req, res) => {
    const receipt = await requireReceipt(deps.repository, String(req.params.id));
    const processed = receipt.files.find((file) => file.kind === "processed_image");
    const original = receipt.files.find((file) => file.kind === "original_image");
    if (!processed) throw new AppError(409, "processed_image_missing", "Vispirms jāizveido apstrādātais attēls.");

    try {
      const [imageBuffer, originalImageBuffer] = await Promise.all([
        deps.storage.readBuffer(processed.storageKey),
        original ? deps.storage.readBuffer(original.storageKey).catch(() => null) : Promise.resolve(null)
      ]);
      const output = await deps.extractor.extract({
        receiptId: receipt.id,
        imageBuffer,
        mimeType: processed.mimeType,
        originalImageBuffer: originalImageBuffer ?? undefined,
        originalMimeType: original?.mimeType
      });
      const extraction = normalizeExtractedMoneyFields(output.extraction);
      const rawFile = await deps.storage.saveBuffer({
        receiptId: receipt.id,
        kind: "raw_ai_response_json",
        buffer: Buffer.from(JSON.stringify(output.rawResponse, null, 2)),
        originalName: "raw-ai-response.json",
        mimeType: "application/json"
      });
      await deps.repository.addFile(receipt.id, rawFile);

      const current = await requireReceipt(deps.repository, receipt.id);
      const duplicate = await deps.repository.findDuplicate({
        receiptId: receipt.id,
        duplicateHash: buildIdentityDuplicateHash(extraction)
      });
      const validation = validateReceiptExtraction(extraction, {
        processedImageExists: Boolean(current.files.find((file) => file.kind === "processed_image")),
        generatedPdfExists: Boolean(current.files.find((file) => file.kind === "generated_pdf")),
        duplicateSuspected: Boolean(duplicate),
        imageQuality: current.imageQuality
      });
      const status: ReceiptStatus = validation.canVerify ? "verified" : "needs_review";
      const updated = await deps.repository.updateReceipt(receipt.id, {
        status,
        merchantDisplayName: extraction.merchant.merchant_display_name ?? extraction.merchant.legal_company_name,
        receiptDate: extraction.identity.date,
        receiptTime: extraction.identity.time,
        currency: extraction.identity.currency ?? extraction.totals.grand_total.currency ?? "EUR",
        grandTotalCents: extraction.totals.grand_total.cents,
        grandTotalRaw: extraction.totals.grand_total.raw,
        extraction,
        validation,
        duplicateHash: buildIdentityDuplicateHash(extraction)
      });
      await deps.repository.addAudit(receipt.id, {
        action: "receipt_extracted",
        actor: "ai",
        payload: { provider: output.provider, status, rawFileId: rawFile.id }
      });

      res.json({ receipt: updated });
    } catch (error) {
      await deps.repository.updateReceipt(receipt.id, {
        status: "failed",
        failureReason: error instanceof Error ? safeErrorMessage(error.message) : "Ekstrakcija neizdevās."
      });
      throw error;
    }
  });

  router.patch("/:id/extraction", async (req, res) => {
    const receipt = await requireReceipt(deps.repository, String(req.params.id));
    const extraction = normalizeExtractedMoneyFields(req.body.extraction as ReceiptExtraction);
    const validation = validateReceiptExtraction(extraction, {
      processedImageExists: Boolean(receipt.files.find((file) => file.kind === "processed_image")),
      generatedPdfExists: Boolean(receipt.files.find((file) => file.kind === "generated_pdf")),
      duplicateSuspected: false,
      imageQuality: receipt.imageQuality
    });
    const updated = await deps.repository.updateReceipt(receipt.id, {
      status: validation.canVerify ? "verified" : "needs_review",
      merchantDisplayName: extraction.merchant.merchant_display_name ?? extraction.merchant.legal_company_name,
      receiptDate: extraction.identity.date,
      receiptTime: extraction.identity.time,
      currency: extraction.identity.currency ?? extraction.totals.grand_total.currency,
      grandTotalCents: extraction.totals.grand_total.cents,
      grandTotalRaw: extraction.totals.grand_total.raw,
      extraction,
      validation
    });
    await deps.repository.addAudit(receipt.id, {
      action: "manual_correction",
      actor: getActor(req),
      payload: { validationStatus: validation.status }
    });
    res.json({ receipt: updated });
  });

  router.post("/:id/verify", async (req, res) => {
    const receipt = await requireReceipt(deps.repository, String(req.params.id));
    if (!receipt.validation?.canVerify) {
      throw new AppError(409, "cannot_verify", "Čeku nevar verificēt, kamēr validācijas brīdinājumi nav atrisināti.");
    }
    const updated = await deps.repository.updateReceipt(receipt.id, { status: "verified" });
    await deps.repository.addAudit(receipt.id, { action: "verified", actor: getActor(req), payload: {} });
    res.json({ receipt: updated });
  });

  router.post("/:id/needs-review", async (req, res) => {
    const receipt = await requireReceipt(deps.repository, String(req.params.id));
    const updated = await deps.repository.updateReceipt(receipt.id, { status: "needs_review" });
    await deps.repository.addAudit(receipt.id, {
      action: "marked_needs_review",
      actor: getActor(req),
      payload: { reason: req.body?.reason ?? null }
    });
    res.json({ receipt: updated });
  });

  router.post("/:id/void", async (req, res) => {
    const receipt = await requireReceipt(deps.repository, String(req.params.id));
    const updated = await deps.repository.updateReceipt(receipt.id, {
      status: "failed",
      failureReason: "voided"
    });
    await deps.repository.addAudit(receipt.id, {
      action: "voided",
      actor: getActor(req),
      payload: { reason: req.body?.reason ?? null }
    });
    res.json({ receipt: updated });
  });

  return router;
}

async function requireReceipt(repository: ReceiptRepository, id: string): Promise<ReceiptRecord> {
  const receipt = await repository.getReceipt(id);
  if (!receipt) throw new AppError(404, "receipt_not_found", "Čeks nav atrasts.");
  return receipt;
}

function requireUpload(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) throw new AppError(400, "file_missing", "Fails nav pievienots.");
  return file;
}

function validateImageUpload(file: Express.Multer.File): void {
  if (!allowedImageMimes.has(normalizedMime(file.mimetype))) {
    throw new AppError(415, "unsupported_file_type", "Atbalstīti tikai JPG un PNG attēli.");
  }
  if (file.size > config.maxUploadBytes) {
    throw new AppError(413, "file_too_large", "Fails ir par lielu.");
  }
}

function normalizedMime(mimeType: string): string {
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

function parseJsonBody<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildIdentityDuplicateHash(extraction: ReceiptExtraction): string | null {
  const merchant = extraction.merchant.vat_number || extraction.merchant.registration_number || extraction.merchant.merchant_display_name;
  const date = extraction.identity.date;
  const time = extraction.identity.time;
  const number = extraction.identity.receipt_number || extraction.identity.document_number || extraction.identity.transaction_number;
  const total = extraction.totals.grand_total.cents;
  if (!merchant || !date || total == null) return null;
  return [merchant, date, time, number, total].filter(Boolean).join("|").toLowerCase();
}

function modelFromRawResponse(rawResponse: unknown): string | null {
  if (!rawResponse || typeof rawResponse !== "object" || !("model" in rawResponse)) return null;
  const model = (rawResponse as { model?: unknown }).model;
  return typeof model === "string" ? model : null;
}

function safeErrorMessage(message: string): string {
  return message.replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]");
}
