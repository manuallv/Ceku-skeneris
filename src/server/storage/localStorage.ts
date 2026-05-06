import { PDFDocument, rgb } from "pdf-lib";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ReceiptFileRecord } from "../../shared/receiptTypes.js";
import { AppError } from "../errors.js";
import { detectImageDimensions } from "./fileMetadata.js";

export type StoredFileKind = ReceiptFileRecord["kind"];

const mimeExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "application/json": "json"
};

export class LocalFileStorage {
  constructor(private readonly rootDir: string) {}

  async ensureReady() {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async saveBuffer(input: {
    receiptId: string;
    kind: StoredFileKind;
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  }): Promise<ReceiptFileRecord> {
    await this.ensureReady();
    const extension = mimeExtensions[input.mimeType];
    if (!extension) throw new AppError(400, "unsupported_file_type", "Neatbalstīts faila tips.");

    const safeReceiptId = sanitizeSegment(input.receiptId);
    const fileName = `${Date.now()}-${input.kind}-${nanoid(8)}.${extension}`;
    const storageKey = `${safeReceiptId}/${fileName}`;
    const absolutePath = this.absolutePath(storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer, { flag: "wx" });

    const dimensions = detectImageDimensions(input.buffer, input.mimeType);
    return {
      id: nanoid(),
      receiptId: input.receiptId,
      kind: input.kind,
      storageKey,
      originalName: sanitizeFileName(input.originalName),
      mimeType: input.mimeType,
      byteSize: input.buffer.byteLength,
      sha256: sha256(input.buffer),
      width: dimensions.width,
      height: dimensions.height,
      createdAt: new Date().toISOString()
    };
  }

  async readBuffer(storageKey: string): Promise<Buffer> {
    const file = this.absolutePath(storageKey);
    return fs.readFile(file);
  }

  async createReceiptPdf(input: {
    receiptId: string;
    processedImage: Buffer;
    processedMimeType: string;
    merchantName?: string | null;
    receiptDate?: string | null;
  }): Promise<ReceiptFileRecord> {
    const pdf = await PDFDocument.create();
    const image =
      input.processedMimeType === "image/png"
        ? await pdf.embedPng(input.processedImage)
        : await pdf.embedJpg(input.processedImage);

    const width = image.width;
    const height = image.height;
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 36;
    const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });
    page.drawImage(image, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight
    });
    pdf.setTitle(safePdfTitle(input.merchantName, input.receiptDate));
    pdf.setProducer("Ceku skeneris");
    pdf.setCreator("Ceku skeneris");
    const pdfBytes = Buffer.from(await pdf.save());

    return this.saveBuffer({
      receiptId: input.receiptId,
      kind: "generated_pdf",
      buffer: pdfBytes,
      originalName: `${safeFileStem(input.receiptDate ?? "receipt")}-${safeFileStem(input.merchantName ?? input.receiptId)}.pdf`,
      mimeType: "application/pdf"
    });
  }

  absolutePath(storageKey: string): string {
    const safeKey = storageKey.split("/").map(sanitizeSegment).join("/");
    const resolved = path.resolve(this.rootDir, safeKey);
    if (!resolved.startsWith(this.rootDir)) {
      throw new AppError(400, "path_traversal", "Nederīgs faila ceļš.");
    }
    return resolved;
  }
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sanitizeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120);
  if (!safe || safe === "." || safe === "..") throw new AppError(400, "unsafe_path", "Nederīgs faila nosaukums.");
  return safe;
}

function sanitizeFileName(value: string): string {
  return path.basename(value).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180) || "upload";
}

function safeFileStem(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "receipt";
}

function safePdfTitle(merchantName?: string | null, receiptDate?: string | null): string {
  return [receiptDate, merchantName, "Čeks"].filter(Boolean).join(" - ");
}
