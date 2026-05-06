import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { AppError, isAppError } from "./errors.js";
import { logger } from "./logger.js";
import { createReceiptExtractor } from "./ai/createReceiptExtractor.js";
import { createReceiptRepository } from "./repositories/createRepository.js";
import { protectedMode } from "./security.js";
import { LocalFileStorage } from "./storage/localStorage.js";
import { createReceiptRouter } from "./routes/receiptRoutes.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: config.isProduction ? undefined : false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: config.isProduction ? config.publicAppUrl : true, credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

const uploadLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false
});

const repository = await createReceiptRepository();
const storage = new LocalFileStorage(config.localStorageDir);
await storage.ensureReady();
const extractor = createReceiptExtractor();

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.1.0",
    repository: repository.kind,
    openAiConfigured: Boolean(config.openAiApiKey),
    storageWritable: await isStorageWritable(),
    node: process.version
  });
});

app.get("/api/system/check", protectedMode, async (_req, res) => {
  res.json({
    database: {
      connected: true,
      adapter: repository.kind,
      additiveMigrationsEnabled: config.allowAdditiveMigrations
    },
    ai: {
      provider: config.openAiApiKey ? config.aiProvider : "mock",
      configured: Boolean(config.openAiApiKey),
      modelConfigured: Boolean(config.aiModel)
    },
    storage: {
      localDirectoryConfigured: Boolean(config.localStorageDir),
      writable: await isStorageWritable()
    },
    app: {
      version: process.env.npm_package_version ?? "0.1.0",
      node: process.version,
      protectedMode: Boolean(config.appAccessToken && config.appAccessToken !== "change-me-for-protected-mode")
    }
  });
});

app.use("/api/receipts", protectedMode, uploadLimiter, createReceiptRouter({ repository, storage, extractor }));

app.get("/files/:receiptId/:fileId", protectedMode, async (req, res) => {
  const receiptId = String(req.params.receiptId);
  const fileId = String(req.params.fileId);
  const receipt = await repository.getReceipt(receiptId);
  const file = receipt?.files.find((item) => item.id === fileId);
  if (!receipt || !file) throw new AppError(404, "file_not_found", "Fails nav atrasts.");
  const absolute = storage.absolutePath(file.storageKey);
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${file.originalName.replace(/"/g, "")}"`);
  res.sendFile(absolute);
});

const clientDir = path.resolve(process.cwd(), "dist/client");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, {
    extensions: ["html"],
    maxAge: config.isProduction ? "1h" : 0
  }));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: { code: "file_too_large", message: "Fails ir par lielu." } });
  }

  if (isAppError(error)) {
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.expose ? error.message : "Servera kļūda."
      }
    });
  }

  logger.error({ err: error }, "unhandled server error");
  return res.status(500).json({ error: { code: "internal_error", message: "Servera kļūda." } });
});

app.listen(config.port, () => {
  logger.info({ port: config.port, repository: repository.kind }, "Ceku skeneris server started");
});

async function isStorageWritable(): Promise<boolean> {
  try {
    await fs.promises.mkdir(config.localStorageDir, { recursive: true });
    const probe = path.join(config.localStorageDir, ".write-test");
    await fs.promises.writeFile(probe, "ok");
    await fs.promises.unlink(probe);
    return true;
  } catch {
    return false;
  }
}
